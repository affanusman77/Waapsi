// Checks a photo the moment it is taken (2026-11-12): is there ONE clear face? If not, the person
// retakes it. A clear photo also returns a suggested age range and boy/girl for the review form.
// Uses the same quality rules as the match face check (face.ts assessPhoto).
// Fails open (R6): AWS not configured or unreachable -> 'off' / 'error' and the report continues.
//   status: ok | retake | off | error
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { audit } from '../_shared/audit.ts'
import { detectFacesAll, faceCheckConfigured, photoBytes } from '../_shared/face-check.ts'
import { assessPhoto, photoEstimate } from '../_shared/face.ts'

const BUCKETS = new Set(['case-photos', 'child-profiles'])

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const path = typeof body.photo_path === 'string' ? body.photo_path : ''
    const bucket = typeof body.bucket === 'string' && BUCKETS.has(body.bucket) ? body.bucket : 'case-photos'
    if (!path.startsWith(`${caller.id}/`)) throw new HttpError(400, 'bad_media_path')
    if (!faceCheckConfigured()) return json({ status: 'off' })

    try {
      const faces = await detectFacesAll(await photoBytes(admin, bucket, path))
      const a = assessPhoto(faces)
      await audit(admin, { action: 'photo.checked', actor: { type: 'ai' }, payload: { ok: a.ok, why: a.ok ? null : a.why, faces: faces.length } })
      if (!a.ok) return json({ status: 'retake', why: a.why })
      return json({ status: 'ok', estimate: photoEstimate(a.face) })
    } catch (e) {
      await audit(admin, { action: 'photo.check_failed', actor: { type: 'ai' }, payload: { error: String(e).slice(0, 200) } })
      return json({ status: 'error' })
    }
  }),
)
