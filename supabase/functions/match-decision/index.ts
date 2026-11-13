// The finder (or, for under-4s, the safe point staff, R11) looks at the PARENT's photo of the
// child and says "Haan, yehi bacha hai" or "Nahi" (R3: humans decide). Confirm opens the chat.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { assertCanConfirm, loadMatch } from '../_shared/access.ts'
import { audit } from '../_shared/audit.ts'
import { canTransition, transition, type CaseKind, type CaseStatus } from '../_shared/state.ts'
import { supabaseStore } from '../_shared/store.ts'
import { isDirect } from '../_shared/custody.ts'
import { foundReadyForMatch } from '../_shared/pipeline.ts'

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const m = await loadMatch(admin, body.match_id)
    assertCanConfirm(caller, m)
    const decision = body.decision
    if (decision !== 'confirm' && decision !== 'reject') throw new HttpError(400, 'bad_decision')
    if (m.status !== 'suggested') throw new HttpError(409, 'already_decided')

    const store = supabaseStore(admin)
    const actor = { type: 'human' as const, id: caller.id }
    const as = (c: typeof m.found) => ({ id: c.id, kind: c.kind as CaseKind, status: c.status as CaseStatus, direct: c.kind === 'found' && isDirect(c) })

    if (decision === 'confirm') {
      // A side that police took over (or a boy waiting with the finder, R13) is moved back to
      // `matched` first, if the custody rules allow it.
      for (const side of [m.found, m.lost]) {
        if (side.status === 'matched') continue
        const ready = side.kind !== 'found' || (await foundReadyForMatch(admin, side))
        if (ready && canTransition(side.kind as CaseKind, side.status as CaseStatus, 'match_suggested', { type: 'system' })) {
          const next = await transition(store, as(side), 'match_suggested', { type: 'system' }, { match_id: m.id, reason: 'confirm_after_takeover' })
          side.status = next.status
        }
      }
      // The child must be with a safe point (or a boy 4+ with the finder, R13) before anyone is sent there.
      if (m.found.status !== 'matched') throw new HttpError(409, 'not_at_safe_point')
      if (m.lost.status !== 'matched') throw new HttpError(409, 'other_side_not_ready')
      const { data: upd } = await admin.from('matches').update({ status: 'finder_confirmed' }).eq('id', m.id).eq('status', 'suggested').select('id')
      if (!upd?.length) throw new HttpError(409, 'already_decided')
      await transition(store, as(m.found), 'finder_confirmed', actor, { match_id: m.id })
      await transition(store, as(m.lost), 'finder_confirmed', actor, { match_id: m.id })
      // Any other suggestions for either child are now moot.
      await admin
        .from('matches')
        .update({ status: 'finder_rejected' })
        .eq('status', 'suggested')
        .or(`found_case_id.eq.${m.found.id},lost_case_id.eq.${m.lost.id}`)
        .select('found_case_id, lost_case_id')
        .then(async ({ data: moot }) => {
          // The OTHER families/children in those moot suggestions go back to searching
          // (unless they still have another open suggestion), so nobody is left on "possible match".
          const others = new Set((moot ?? []).flatMap((x) => [x.found_case_id, x.lost_case_id]).filter((id) => id !== m.found.id && id !== m.lost.id))
          for (const id of others) await revertIfNoOpenSuggestion(admin, store, id, { type: 'system' })
        })
      await audit(admin, { action: 'finder.confirmed', actor, caseId: m.found.id, matchId: m.id, payload: { role: caller.role } })
      return json({ match: { id: m.id, status: 'finder_confirmed' } })
    }

    await admin.from('matches').update({ status: 'finder_rejected' }).eq('id', m.id)
    await audit(admin, { action: 'finder.rejected', actor, caseId: m.found.id, matchId: m.id, payload: { role: caller.role } })
    // Each side goes back to waiting unless another suggestion is still open for it.
    for (const side of [m.found, m.lost]) {
      const col = side.id === m.found.id ? 'found_case_id' : 'lost_case_id'
      const { count } = await admin.from('matches').select('id', { count: 'exact', head: true }).eq(col, side.id).eq('status', 'suggested')
      if (!count && canTransition(side.kind as CaseKind, side.status as CaseStatus, 'finder_rejected', actor)) {
        await transition(store, as(side), 'finder_rejected', actor, { match_id: m.id })
      }
    }
    return json({ match: { id: m.id, status: 'finder_rejected' } })
  }),
)

/** Sends a case back from `matched` to waiting when it has no open suggestion left. */
async function revertIfNoOpenSuggestion(
  admin: ReturnType<typeof adminClient>,
  store: ReturnType<typeof supabaseStore>,
  caseId: string,
  actor: { type: 'system' },
) {
  const { data: c } = await admin.from('cases').select('id, kind, status, gender, age_est, flags, safe_point_id').eq('id', caseId).single()
  if (!c || c.status !== 'matched') return
  const col = c.kind === 'found' ? 'found_case_id' : 'lost_case_id'
  const { count } = await admin.from('matches').select('id', { count: 'exact', head: true }).eq(col, c.id).eq('status', 'suggested')
  if (count) return
  await transition(store, { id: c.id, kind: c.kind as CaseKind, status: c.status as CaseStatus, direct: c.kind === 'found' && isDirect(c) }, 'match_withdrawn', actor).catch(() => {})
}
