// HTTP entry point for case-level human status changes. Checks WHO may do WHAT (roles,
// ownership, girls' protocol), then delegates to state.ts transition(), which validates the move
// and updates the case, the police record and the audit log.
// Match-level steps live in match-decision (confirm/reject) and handover (verify/fail).
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { isStaffAt, loadCase } from '../_shared/access.ts'
import { transition, type CaseEvent, type CaseKind, type CaseStatus } from '../_shared/state.ts'
import { supabaseStore } from '../_shared/store.ts'
import { inBackground, runMatching } from '../_shared/pipeline.ts'
import { timeScale } from '../_shared/settings.ts'

const ENABLED_EVENTS = new Set<CaseEvent>(['safe_point_chosen', 'safe_point_accepted', 'convert_to_lost', 'close_no_match'])

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)

    const event = body.event as CaseEvent
    if (!ENABLED_EVENTS.has(event)) throw new HttpError(400, 'event_not_available')
    const c = await loadCase(admin, body.case_id)
    const patch: Record<string, unknown> = {}

    if (event === 'safe_point_chosen') {
      if (c.reporter_id !== caller.id && caller.role !== 'admin') throw new HttpError(403, 'not_your_case')
      const sp = await loadSafePoint(admin, body.safe_point_id)
      if (c.gender === 'female' && !sp.women_staff) throw new HttpError(409, 'girls_need_women_staff') // R4
      patch.safe_point_id = sp.id
    }

    if (event === 'safe_point_accepted') {
      if (caller.role !== 'admin') {
        if (caller.role !== 'sp_staff' || !caller.safe_point_id) throw new HttpError(403, 'staff_only')
        // Staff accept children headed to THEIR safe point, or a child brought straight to the desk.
        if (c.safe_point_id && !isStaffAt(caller, c.safe_point_id)) throw new HttpError(403, 'other_safe_point')
      }
      if (!c.safe_point_id) patch.safe_point_id = caller.safe_point_id
      const sp = await loadSafePoint(admin, c.safe_point_id ?? caller.safe_point_id)
      if (c.gender === 'female' && !sp.women_staff) throw new HttpError(409, 'girls_need_women_staff')
    }

    if (event === 'convert_to_lost') {
      // "Mera bacha gum ho gaya": the check-in's photo and clothing are reused as a lost report.
      if (c.reporter_id !== caller.id) throw new HttpError(403, 'not_your_case')
      const scale = await timeScale(admin)
      patch.seen_at = new Date().toISOString()
      patch.expires_at = null
      patch.escalate_at = new Date(Date.now() + (3600_000 / scale)).toISOString()
    }

    if (event === 'close_no_match' && caller.role !== 'admin') throw new HttpError(403, 'admin_only')

    const next = await transition(
      supabaseStore(admin),
      { id: c.id, kind: c.kind as CaseKind, status: c.status as CaseStatus },
      event,
      { type: 'human', id: caller.id },
      { role: caller.role },
      patch,
    )

    // Accepted into custody / converted to a lost report -> look for matches now (R10).
    if (event === 'safe_point_accepted' || event === 'convert_to_lost') inBackground(runMatching(admin, c.id))
    return json({ case: { id: c.id, ...next, safe_point_id: patch.safe_point_id ?? c.safe_point_id } })
  }),
)

async function loadSafePoint(admin: ReturnType<typeof adminClient>, id: unknown) {
  if (typeof id !== 'string') throw new HttpError(400, 'safe_point_required')
  const { data } = await admin.from('safe_points').select('id, women_staff, active').eq('id', id).maybeSingle()
  if (!data || !data.active) throw new HttpError(404, 'safe_point_not_found')
  return data as { id: string; women_staff: boolean; active: boolean }
}
