// Creates a case + its police record + audit entries in ONE transaction (R5, R7), then runs the
// AI pipeline and matching in the background so the reporter gets an answer immediately (R6).
//   found   : finder (or staff/admin for a child brought to a desk)
//   lost    : parent ("Mera bacha gum hai"), optionally from a saved child profile (F1)
//   checkin : parent at the event gate ("Aaj ki Tasveer"), expires after 48 h (R9)
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { audit } from '../_shared/audit.ts'
import { normName } from '../_shared/matching.ts'
import { COLOURS } from '../_shared/extract-fallback.ts'
import { inBackground, processCase } from '../_shared/pipeline.ts'
import { timeScale } from '../_shared/settings.ts'
import { notifyCaseCreated, notifyLater } from '../_shared/whatsapp.ts'

const ROLES: Record<string, Set<string>> = {
  found: new Set(['finder', 'parent', 'sp_staff', 'admin']),
  lost: new Set(['parent', 'finder', 'admin']),
  checkin: new Set(['parent', 'finder', 'admin']),
}

function str(v: unknown, max = 500): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}
function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
const colour = (v: unknown) => (typeof v === 'string' && (COLOURS as readonly string[]).includes(v) ? v : null)

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)

    const kind = String(body.kind)
    if (!ROLES[kind]) throw new HttpError(400, 'unsupported_kind')
    if (!ROLES[kind].has(caller.role)) throw new HttpError(403, 'role_not_allowed')

    const f = (body.fields ?? {}) as Record<string, unknown>
    const ownPath = (v: unknown) => {
      const p = str(v, 300)
      if (p && !p.startsWith(`${caller.id}/`)) throw new HttpError(400, 'bad_media_path')
      return p
    }

    const gender = f.gender === 'male' || f.gender === 'female' ? f.gender : null
    const under4 = f.under_4 === true
    const lat = num(f.lat, -90, 90)
    const lng = num(f.lng, -180, 180)
    if (kind === 'found' && (lat === null || lng === null)) throw new HttpError(400, 'location_required')

    const childName = str(f.child_name, 60)
    const fatherName = str(f.father_name, 60)
    const ageEst = num(f.age_est, 0, 18) ?? (under4 ? 3 : null)
    const clothing = f.top_color || f.bottom_color ? { top_color: colour(f.top_color), top_type: str(f.top_type, 30), bottom_color: colour(f.bottom_color), bottom_type: str(f.bottom_type, 30), other: [] } : null

    // Fields a human typed or tapped are never overwritten by AI.
    const humanFields = Object.entries({ gender, age_est: f.age_est ?? (under4 ? 3 : null), child_name: childName, father_name: fatherName, clothing })
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k]) => k)

    // Last-seen time for lost reports ("kitni dair pehle").
    const minutesAgo = num(f.minutes_ago, 0, 24 * 60)
    const seenAt = kind === 'lost' && minutesAgo !== null ? new Date(Date.now() - minutesAgo * 60_000).toISOString() : null

    // F1: report from a saved child profile -> copy its photo into the case (owner check first).
    let photoPath = ownPath(f.photo_path)
    let childId: string | null = null
    if (typeof f.child_id === 'string') {
      const { data: child } = await admin.from('children').select('*').eq('id', f.child_id).maybeSingle()
      if (!child || child.parent_id !== caller.id) throw new HttpError(403, 'not_your_child')
      childId = child.id
      if (!photoPath && child.photo_path) {
        const { data: blob } = await admin.storage.from('child-profiles').download(child.photo_path)
        if (blob) {
          const to = `${caller.id}/${crypto.randomUUID()}.jpg`
          const { error } = await admin.storage.from('case-photos').upload(to, blob, { contentType: blob.type || 'image/jpeg' })
          if (!error) photoPath = to
        }
      }
    }

    const flags: string[] = []
    if (under4) flags.push('under_4') // R11: safe point handles every step
    if (f.location_approx === true) flags.push('location_approx')

    const fields = {
      child_id: childId,
      child_name: childName,
      father_name: fatherName,
      gender,
      age_est: ageEst,
      notes: str(f.notes, 1000),
      transcript: str(f.typed_text, 2000),
      photo_path: photoPath,
      wrist_photo_path: ownPath(f.wrist_photo_path),
      voice_path: ownPath(f.voice_path),
      lat,
      lng,
      seen_at: seenAt,
      flags,
    }
    if (childId && !fields.child_name) {
      const { data: child } = await admin.from('children').select('name, gender, birth_year').eq('id', childId).single()
      if (child) {
        fields.child_name = child.name
        fields.gender = fields.gender ?? child.gender
        if (fields.age_est === null && child.birth_year) fields.age_est = new Date().getFullYear() - child.birth_year
        humanFields.push('child_name')
      }
    }

    // R5: police take over after 60 minutes. DEMO_TIME_SCALE=60 turns that into 1 real minute.
    const scale = await timeScale(admin)
    const escalateAfter = `${Math.max(1, Math.round((60 * 60) / scale))} seconds`

    const { data, error } = await admin.rpc('create_case_tx', {
      p_reporter: caller.id,
      p_kind: kind,
      p_fields: fields,
      p_escalate_after: escalateAfter,
    })
    if (error) throw new HttpError(500, 'create_failed', error.message)

    await admin
      .from('cases')
      .update({
        clothing,
        child_name_norm: fields.child_name ? normName(fields.child_name) : null,
        father_name_norm: fatherName ? normName(fatherName) : null,
        ai_extract: { human_fields: humanFields },
      })
      .eq('id', data.id)

    // Abuse flags (section 10): flag only, never block, never auto-punish.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count } = await admin
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .eq('reporter_id', caller.id)
      .eq('kind', kind)
      .gte('created_at', since)
    const abuse = kind === 'found' ? 'frequent_finder' : kind === 'lost' ? 'multi_claim' : null
    if (abuse && (count ?? 0) > 2) {
      await admin.from('cases').update({ flags: [...flags, abuse] }).eq('id', data.id)
      await audit(admin, { action: `flag.${abuse}`, actor: { type: 'system' }, caseId: data.id, payload: { count } })
    }

    inBackground(processCase(admin, data.id))
    notifyLater(notifyCaseCreated(admin, data.id)) // F3: police WhatsApp alert
    return json({ case: { id: data.id, status: data.status, kind: data.kind, escalate_at: data.escalate_at } })
  }),
)
