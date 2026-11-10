// P1 end-to-end smoke test against the live project: finder reports a girl -> girls' protocol
// -> safe point chosen -> only the right (women-staffed) safe point can accept -> police record follows.
// Run: node --env-file=.env.local scripts/smoke-p1.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const pw = process.env.DEMO_USER_PASSWORD
const SHRINE_GATE = '00000000-0000-4000-a000-000000000001' // Behan Desk, staff +923000000003
const GHANTA_GHAR = '00000000-0000-4000-a000-000000000002' // no women staff, staff +923000000004

async function as(phone) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: `${phone}@demo.wapsi.app`, password: pw })
  if (error) throw new Error(`${phone}: ${error.message}`)
  return c
}
async function call(client, fn, body) {
  const { data, error } = await client.functions.invoke(fn, { body })
  if (!error) return { ok: true, data }
  const detail = await error.context?.json?.().catch(() => null)
  return { ok: false, status: error.context?.status, error: detail?.error ?? error.message }
}

let failures = 0
function check(label, cond, got) {
  if (!cond) failures++
  console.log(`${cond ? '✓' : '✗'} ${label}${cond ? '' : ` -> ${JSON.stringify(got)}`}`)
}

const finder = await as('923000000001')
const femaleStaff = await as('923000000003')
const maleStaff = await as('923000000004')
const admin = await as('923000000005')

const created = await call(finder, 'create-case', {
  kind: 'found',
  fields: { gender: 'female', under_4: true, lat: 30.1976, lng: 71.4699, typed_text: 'smoke test: girl, about 3' },
})
check('finder creates a found case', created.ok && created.data.case.status === 'reported', created)
const caseId = created.data?.case?.id

const { data: pr1 } = await admin.from('police_records').select('status').eq('case_id', caseId).single()
check('police record created with the case (R5)', pr1?.status === 'Record only', pr1)

const wrongSp = await call(finder, 'case-transition', { case_id: caseId, event: 'safe_point_chosen', safe_point_id: GHANTA_GHAR })
check("girls' protocol blocks a point without women staff (R4)", wrongSp.error === 'girls_need_women_staff', wrongSp)

const chosen = await call(finder, 'case-transition', { case_id: caseId, event: 'safe_point_chosen', safe_point_id: SHRINE_GATE })
check('finder chooses the Behan Desk -> awaiting_safe_point', chosen.data?.case?.status === 'awaiting_safe_point', chosen)

const finderAccept = await call(finder, 'case-transition', { case_id: caseId, event: 'safe_point_accepted' })
check('finder cannot accept custody', finderAccept.status === 403, finderAccept)

const otherStaff = await call(maleStaff, 'case-transition', { case_id: caseId, event: 'safe_point_accepted' })
check('staff of another safe point cannot accept', otherStaff.error === 'other_safe_point', otherStaff)

const { data: staffView } = await femaleStaff.from('cases').select('id,status').eq('id', caseId)
check('Behan Desk staff can see the incoming case (RLS)', staffView?.length === 1, staffView)
const { data: otherView } = await maleStaff.from('cases').select('id').eq('id', caseId)
check('other safe point staff cannot see it (RLS)', otherView?.length === 0, otherView)

const accepted = await call(femaleStaff, 'case-transition', { case_id: caseId, event: 'safe_point_accepted' })
check('Behan Desk staff accept -> at_safe_point (R10)', accepted.data?.case?.status === 'at_safe_point', accepted)

const again = await call(femaleStaff, 'case-transition', { case_id: caseId, event: 'safe_point_accepted' })
check('accepting twice is rejected by the state machine', again.error === 'invalid_transition', again)

const { data: pr2 } = await admin.from('police_records').select('status').eq('case_id', caseId).single()
check('police record follows custody: In safe custody (R12)', pr2?.status === 'In safe custody', pr2)

const { data: log } = await admin.from('audit_log').select('action,actor').eq('case_id', caseId).order('id')
check(
  'every step audited (R7)',
  ['case.created', 'police.record_created', 'case.safe_point_chosen', 'police.status_changed', 'case.safe_point_accepted'].every((a) =>
    log?.some((l) => l.action === a),
  ),
  log?.map((l) => l.action),
)

const { data: flags } = await admin.from('cases').select('flags').eq('id', caseId).single()
check('under-4 flag stored (R11)', flags?.flags?.includes('under_4'), flags)

console.log(failures ? `\n${failures} check(s) FAILED` : '\nP1 smoke test passed')
process.exit(failures ? 1 : 0)
