// Short-lived signed URLs for case photos, after a server-side role check (R1: buckets are private).
//   which = 'photo' | 'wrist'  (case_id): reporter, staff of that safe point, admin; police via
//                                          an explicit, audited reveal.
//   which = 'lost_photo'       (match_id): the PARENT's photo of the child, for the finder (not for
//                                          under-4s), staff of the safe point holding the child, admin (R2).
// Parents never receive a found child's photo: they are not its reporter, staff or admin.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { isStaffAt, loadMatch } from '../_shared/access.ts'
import { audit } from '../_shared/audit.ts'

const TTL_SECONDS = 120

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const actor = { type: 'human' as const, id: caller.id }

    if (body.which === 'lost_photo') {
      const m = await loadMatch(admin, body.match_id)
      if (m.status === 'finder_rejected') throw new HttpError(403, 'not_allowed')
      const under4 = m.found.flags?.includes('under_4')
      const allowed = caller.role === 'admin' || isStaffAt(caller, m.found.safe_point_id) || (m.found.reporter_id === caller.id && !under4)
      if (!allowed) throw new HttpError(403, 'not_allowed')
      const { data: l } = await admin.from('cases').select('photo_path').eq('id', m.lost.id).single()
      if (!l?.photo_path) return json({ url: null })
      const { data, error } = await admin.storage.from('case-photos').createSignedUrl(l.photo_path, TTL_SECONDS)
      if (error) throw new HttpError(500, 'sign_failed', error.message)
      await audit(admin, { action: 'media.parent_photo_viewed', actor, caseId: m.found.id, matchId: m.id, payload: { role: caller.role } })
      return json({ url: data.signedUrl })
    }

    const caseId = typeof body.case_id === 'string' ? body.case_id : null
    if (!caseId) throw new HttpError(400, 'case_id_required')
    const which = body.which === 'wrist' ? 'wrist_photo_path' : 'photo_path'
    const { data: c } = await admin
      .from('cases')
      .select('id, kind, reporter_id, safe_point_id, photo_path, wrist_photo_path')
      .eq('id', caseId)
      .maybeSingle()
    if (!c) throw new HttpError(404, 'case_not_found')

    const police = caller.role === 'police'
    const allowed = c.reporter_id === caller.id || caller.role === 'admin' || police || isStaffAt(caller, c.safe_point_id)
    if (!allowed) throw new HttpError(403, 'not_allowed')
    // Police see photos only on an explicit tap ("reveal"), which is always audited.
    if (police && body.reveal !== true) throw new HttpError(403, 'reveal_required')

    const path = c[which as 'photo_path' | 'wrist_photo_path'] as string | null
    if (!path) return json({ url: null })
    const bucket = which === 'photo_path' ? 'case-photos' : 'wrist-photos'
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, TTL_SECONDS)
    if (error) throw new HttpError(500, 'sign_failed', error.message)

    if (c.reporter_id !== caller.id) {
      await audit(admin, { action: police ? 'media.police_reveal' : 'media.viewed', actor, caseId, payload: { which, role: caller.role } })
    }
    return json({ url: data.signedUrl })
  }),
)
