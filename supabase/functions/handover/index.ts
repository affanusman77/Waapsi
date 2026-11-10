// Safe point handover (R3, R4, R11): staff open the checklist ("start"), then either verify the
// handover (case -> reunited, police -> Reunited) or block it ("Something's wrong": the child
// stays, police -> URGENT, parent flagged). Only staff of the safe point holding the child (or admin).
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { isStaffAt, loadMatch } from '../_shared/access.ts'
import { audit } from '../_shared/audit.ts'
import { transition, type CaseKind, type CaseStatus } from '../_shared/state.ts'
import { supabaseStore } from '../_shared/store.ts'

type Checklist = {
  gallery_photo_match?: boolean
  b_form_seen?: boolean
  child_reaction_ok?: boolean
  finder_confirmed?: boolean
  female_staff_present?: boolean
}

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const m = await loadMatch(admin, body.match_id)
    if (caller.role !== 'admin' && !isStaffAt(caller, m.found.safe_point_id)) throw new HttpError(403, 'staff_only')

    const store = supabaseStore(admin)
    const actor = { type: 'human' as const, id: caller.id }
    const as = (c: typeof m.found) => ({ id: c.id, kind: c.kind as CaseKind, status: c.status as CaseStatus })

    if (body.action === 'start') {
      if (m.status !== 'finder_confirmed') throw new HttpError(409, 'not_confirmed')
      await transition(store, as(m.found), 'verification_started', actor, { match_id: m.id })
      await transition(store, as(m.lost), 'verification_started', actor, { match_id: m.id })

      // Abuse flag (section 10): a thin lost report reaching handover within 10 minutes.
      const { data: lost } = await admin.from('cases').select('child_name, father_name, age_est, gender, clothing, photo_path, kind, created_at, flags').eq('id', m.lost.id).single()
      if (lost && lost.kind === 'lost') {
        const known = [lost.child_name, lost.father_name, lost.age_est, lost.gender, lost.photo_path, lost.clothing?.top_color].filter((x) => x !== null && x !== undefined).length
        if (known < 3 && Date.now() - Date.parse(lost.created_at) < 10 * 60_000) {
          await admin.from('cases').update({ flags: [...new Set([...(lost.flags ?? []), 'low_detail_fast_claim'])] }).eq('id', m.lost.id)
          await audit(admin, { action: 'flag.low_detail_fast_claim', actor: { type: 'system' }, caseId: m.lost.id, matchId: m.id, payload: { known } })
        }
      }
      return json({ ok: true, status: 'verifying' })
    }

    if (body.action !== 'complete') throw new HttpError(400, 'bad_action')
    if (m.found.status !== 'verifying') throw new HttpError(409, 'not_verifying')
    const result = body.result
    if (result !== 'verified' && result !== 'failed') throw new HttpError(400, 'bad_result')
    const cl = (body.checklist ?? {}) as Checklist
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null

    if (result === 'verified') {
      const girl = m.found.gender === 'female' || m.lost.gender === 'female'
      const under4 = m.found.flags?.includes('under_4')
      const missing: string[] = []
      if (!cl.gallery_photo_match) missing.push('gallery_photo_match')
      if (!cl.child_reaction_ok) missing.push('child_reaction_ok')
      if (!cl.finder_confirmed) missing.push('finder_confirmed')
      if (under4 && !cl.b_form_seen) missing.push('b_form_seen') // R11: no verbal confirmation possible
      // R4: for a girl, a FEMALE staff member must be present and tick it.
      if (girl && (!cl.female_staff_present || (caller.role !== 'admin' && caller.gender !== 'female'))) missing.push('female_staff_present')
      if (missing.length) throw new HttpError(422, 'checklist_incomplete', missing.join(','))
    }

    await admin.from('handovers').insert({ match_id: m.id, staff_id: caller.id, checklist: cl, result, reason })

    if (result === 'verified') {
      const now = new Date().toISOString()
      await transition(store, as(m.found), 'handover_verified', actor, { match_id: m.id }, { reunited_at: now })
      await transition(store, as(m.lost), 'handover_verified', actor, { match_id: m.id }, { reunited_at: now })
      await admin.from('matches').update({ status: 'reunited' }).eq('id', m.id)
      const seconds = Math.round((Date.parse(now) - Date.parse(m.found.created_at)) / 1000)
      await audit(admin, { action: 'handover.verified', actor, caseId: m.found.id, matchId: m.id, payload: { reunion_seconds: seconds } })
      return json({ ok: true, status: 'reunited', reunion_seconds: seconds })
    }

    await transition(store, as(m.found), 'handover_failed', actor, { match_id: m.id, reason })
    await transition(store, as(m.lost), 'handover_failed', actor, { match_id: m.id, reason })
    await admin.from('matches').update({ status: 'blocked' }).eq('id', m.id)
    if (m.lost.reporter_id) {
      const { data: p } = await admin.from('profiles').select('flags').eq('id', m.lost.reporter_id).single()
      await admin.from('profiles').update({ flags: [...new Set([...(p?.flags ?? []), 'verification_failed'])] }).eq('id', m.lost.reporter_id)
    }
    await audit(admin, { action: 'handover.failed', actor, caseId: m.found.id, matchId: m.id, payload: { reason } })
    return json({ ok: true, status: 'handover_blocked' })
  }),
)
