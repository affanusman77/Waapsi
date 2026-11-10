// Human edits to a case's details (the editable chips on the case card). Never changes status.
// Edited fields are marked human so AI never overwrites them, then matching re-runs.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { assertCaseActor, loadCase } from '../_shared/access.ts'
import { audit } from '../_shared/audit.ts'
import { COLOURS } from '../_shared/extract-fallback.ts'
import { normName } from '../_shared/matching.ts'
import { FINAL_STATUSES, type CaseStatus } from '../_shared/state.ts'
import { inBackground, runMatching } from '../_shared/pipeline.ts'

const s = (v: unknown, max = 60) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const colour = (v: unknown) => (typeof v === 'string' && (COLOURS as readonly string[]).includes(v) ? v : null)

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const c = await loadCase(admin, body.case_id)
    assertCaseActor(caller, c)
    if (FINAL_STATUSES.has(c.status as CaseStatus)) throw new HttpError(409, 'case_closed')

    const input = (body.fields ?? {}) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if ('child_name' in input) {
      patch.child_name = s(input.child_name)
      patch.child_name_norm = patch.child_name ? normName(patch.child_name as string) : null
    }
    if ('father_name' in input) {
      patch.father_name = s(input.father_name)
      patch.father_name_norm = patch.father_name ? normName(patch.father_name as string) : null
    }
    if ('age_est' in input) {
      const n = Number(input.age_est)
      patch.age_est = input.age_est === null || input.age_est === '' ? null : Number.isFinite(n) && n >= 0 && n <= 18 ? Math.round(n) : null
    }
    if ('gender' in input) {
      patch.gender = input.gender === 'male' || input.gender === 'female' ? input.gender : null
      // R4: a girl can't be at / heading to a point without women staff.
      if (patch.gender === 'female' && c.safe_point_id) {
        const { data: sp } = await admin.from('safe_points').select('women_staff').eq('id', c.safe_point_id).single()
        if (sp && !sp.women_staff) throw new HttpError(409, 'girls_need_women_staff')
      }
    }
    if ('clothing' in input && input.clothing && typeof input.clothing === 'object') {
      const cl = input.clothing as Record<string, unknown>
      patch.clothing = { top_color: colour(cl.top_color), top_type: s(cl.top_type, 30), bottom_color: colour(cl.bottom_color), bottom_type: s(cl.bottom_type, 30), other: [] }
    }
    if ('notes' in input) patch.notes = s(input.notes, 1000)
    if (!Object.keys(patch).length) throw new HttpError(400, 'nothing_to_update')

    const { data: cur } = await admin.from('cases').select('ai_extract').eq('id', c.id).single()
    const meta = (cur?.ai_extract ?? {}) as Record<string, unknown>
    const human = new Set([...((meta.human_fields as string[]) ?? []), ...Object.keys(patch).filter((k) => !k.endsWith('_norm'))])
    await admin.from('cases').update({ ...patch, ai_extract: { ...meta, human_fields: [...human] } }).eq('id', c.id)
    await audit(admin, { action: 'case.edited', actor: { type: 'human', id: caller.id }, caseId: c.id, payload: { fields: Object.keys(patch) } })

    inBackground(runMatching(admin, c.id))
    return json({ ok: true })
  }),
)
