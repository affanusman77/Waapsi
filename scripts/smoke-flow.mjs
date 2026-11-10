// End-to-end test of P2–P5 against the live project (spec section 15 demo story + failure path).
// Run: node --env-file=.env.local scripts/smoke-flow.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const pw = process.env.DEMO_USER_PASSWORD
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SHRINE_GATE = '00000000-0000-4000-a000-000000000001' // Behan Desk, female staff 0003
const GHANTA_GHAR = '00000000-0000-4000-a000-000000000002' // male staff 0004
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 1x1 PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

async function as(phone) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email: `${phone}@demo.wapsi.app`, password: pw })
  if (error) throw new Error(`${phone}: ${error.message}`)
  c.uid = data.user.id
  return c
}
async function call(client, fn, body) {
  const { data, error } = await client.functions.invoke(fn, { body })
  if (!error) return { ok: true, ...data }
  const detail = await error.context?.json?.().catch(() => null)
  return { ok: false, status: error.context?.status, error: detail?.error ?? error.message, message: detail?.message }
}
async function upload(client, bucket) {
  const path = `${client.uid}/${crypto.randomUUID()}.png`
  const { error } = await client.storage.from(bucket).upload(path, new Blob([PNG], { type: 'image/png' }))
  if (error) throw error
  return path
}
async function waitFor(label, fn, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(700)
  }
  return null
}
const caseRow = async (id) => (await service.from('cases').select('*').eq('id', id).single()).data
const policeOf = async (id) => (await service.from('police_records').select('status').eq('case_id', id).single()).data?.status

let failures = 0
function check(label, cond, got) {
  if (!cond) failures++
  console.log(`${cond ? '✓' : '✗'} ${label}${cond ? '' : ` -> ${JSON.stringify(got)?.slice(0, 300)}`}`)
}

const [finder, parent, femaleStaff, maleStaff, admin, police] = await Promise.all(
  ['923000000001', '923000000002', '923000000003', '923000000004', '923000000005', '923000000006'].map(as),
)

console.log('\n— Happy path: gate check-in + found child —')
const ciPhoto = await upload(parent, 'case-photos')
const ci = await call(parent, 'create-case', {
  kind: 'checkin',
  fields: { child_name: 'Aly', father_name: 'Rza', age_est: 5, gender: 'male', top_color: 'red', top_type: 'shirt', lat: 30.2002, lng: 71.469, photo_path: ciPhoto },
})
check('parent gate check-in created', ci.ok, ci)
const ciRow = await caseRow(ci.case.id)
check('check-in expires in 48 h, no escalation (R9)', ciRow.expires_at && !ciRow.escalate_at, ciRow)

const fPhoto = await upload(finder, 'case-photos')
const found = await call(finder, 'create-case', {
  kind: 'found',
  fields: {
    gender: 'male',
    typed_text: 'Ye bacha mila hai, naam Ali bata raha, abu ka naam Raza, Hussain Agahi ke paas. 5 saal ka larka laal shirt.',
    lat: 30.1962,
    lng: 71.4738,
    photo_path: fPhoto,
  },
})
check('finder report created', found.ok, found)
const fid = found.case.id

const extracted = await waitFor('extract', async () => {
  const r = await caseRow(fid)
  return r.ai_status !== 'pending' ? r : null
})
check('pipeline ran in background (fail-open keyword fallback without AI key)', !!extracted && ['ok', 'fallback'].includes(extracted.ai_status), extracted?.ai_status)
check('extracted child name Ali, father Raza, age 5, red shirt', extracted?.child_name === 'Ali' && extracted?.father_name === 'Raza' && extracted?.age_est === 5 && extracted?.clothing?.top_color === 'red', {
  n: extracted?.child_name, f: extracted?.father_name, a: extracted?.age_est, c: extracted?.clothing,
})

const q = await call(finder, 'ai-next-question', { case_id: fid })
check('guided question suggested for the most important missing field', q.ok && q.question?.ur && q.question?.en, q)

const m0 = await waitFor('match row', async () => (await service.from('matches').select('*').eq('found_case_id', fid).eq('lost_case_id', ci.case.id).maybeSingle()).data)
check('match suggested with score ≥ 0.8 (strong) and reasons', m0 && Number(m0.score) >= 0.8 && m0.reasons.length >= 4, m0 && { score: m0.score, reasons: m0.reasons.map((r) => r.text_en) })
console.log('   reasons:', m0?.reasons.map((r) => r.text_en).join(' | '), '| score', m0?.score)
check('found case NOT matched before a safe point accepts (R10)', (await caseRow(fid)).status === 'reported', (await caseRow(fid)).status)
check('check-in side moves to matched', (await caseRow(ci.case.id)).status === 'matched', (await caseRow(ci.case.id)).status)

const pv0 = (await parent.from('parent_match_view').select('*')).data
check('parent sees "possible match" but no safe point yet (R2)', pv0?.some((v) => v.match_id === m0.id && !v.safe_point_name_en), pv0)
check('parent cannot read the found case row (R2)', ((await parent.from('cases').select('id,photo_path,lat,lng').eq('id', fid)).data ?? []).length === 0)
const parentPhoto = await call(parent, 'media-url', { case_id: fid })
check("parent can't get the found child's photo (R2)", parentPhoto.status === 403, parentPhoto)
const earlyConfirm = await call(finder, 'match-decision', { match_id: m0.id, decision: 'confirm' })
check('confirm blocked until child is at the safe point', earlyConfirm.error === 'not_at_safe_point', earlyConfirm)

await call(finder, 'case-transition', { case_id: fid, event: 'safe_point_chosen', safe_point_id: GHANTA_GHAR })
const acc = await call(maleStaff, 'case-transition', { case_id: fid, event: 'safe_point_accepted' })
check('safe point accepts the child', acc.ok, acc)
check('after acceptance the found case is matched', !!(await waitFor('matched', async () => (await caseRow(fid)).status === 'matched')), (await caseRow(fid)).status)

const fv = (await finder.from('finder_match_view').select('*').eq('match_id', m0.id)).data
check('finder sees the parent’s description + reasons (finder_match_view)', fv?.length === 1 && fv[0].lost_child_name === 'Aly', fv)
const lostPhoto = await call(finder, 'media-url', { which: 'lost_photo', match_id: m0.id })
check('finder gets a signed URL of the PARENT’s photo (R2)', lostPhoto.ok && lostPhoto.url?.includes('token='), lostPhoto)
const strangerPhoto = await call(femaleStaff, 'media-url', { which: 'lost_photo', match_id: m0.id })
check('staff of another safe point cannot', strangerPhoto.status === 403, strangerPhoto)

const preChat = await call(parent, 'send-message', { match_id: m0.id, body: 'hello' })
check('chat closed before the finder confirms', preChat.error === 'chat_closed', preChat)
const conf = await call(finder, 'match-decision', { match_id: m0.id, decision: 'confirm' })
check('finder confirms "Haan, yehi bacha hai"', conf.ok, conf)
const pv1 = (await parent.from('parent_match_view').select('*').eq('match_id', m0.id)).data?.[0]
check('parent now sees which safe point to go to', pv1?.safe_point_name_en === 'Ghanta Ghar Help Desk', pv1)

const msg = await call(parent, 'send-message', { match_id: m0.id, body: 'Shukriya! Mera number 0300 1234567 hai' })
check('chat works and phone numbers are masked (R8)', msg.ok && msg.message.masked && !msg.message.body.includes('1234567'), msg)
check('finder reads the chat', ((await finder.from('messages').select('body').eq('match_id', m0.id)).data ?? []).length === 1)
check('outsiders cannot read the chat', ((await femaleStaff.from('messages').select('id').eq('match_id', m0.id)).data ?? []).length === 0)

const start = await call(maleStaff, 'handover', { match_id: m0.id, action: 'start' })
check('staff start verification', start.ok, start)
const incomplete = await call(maleStaff, 'handover', { match_id: m0.id, action: 'complete', result: 'verified', checklist: { gallery_photo_match: true } })
check('incomplete checklist rejected', incomplete.error === 'checklist_incomplete', incomplete)
const done = await call(maleStaff, 'handover', {
  match_id: m0.id,
  action: 'complete',
  result: 'verified',
  checklist: { gallery_photo_match: true, child_reaction_ok: true, finder_confirmed: true, b_form_seen: false },
})
check('handover verified -> REUNITED', done.ok && done.status === 'reunited', done)
console.log(`   reunion time: ${done.reunion_seconds}s`)
check('police records say Reunited on both sides', (await policeOf(fid)) === 'Reunited' && (await policeOf(ci.case.id)) === 'Reunited')
check('reunited_at set (reunion timer)', !!(await caseRow(fid)).reunited_at)

console.log('\n— Failure path + girls protocol —')
const lostG = await call(parent, 'create-case', {
  kind: 'lost',
  fields: { child_name: 'Ayesha', father_name: 'Kamran', age_est: 7, gender: 'female', top_color: 'pink', top_type: 'frock', lat: 30.2, lng: 71.469, minutes_ago: 20, photo_path: await upload(parent, 'case-photos') },
})
check('parent lost report (girl)', lostG.ok, lostG)
const foundG = await call(finder, 'create-case', {
  kind: 'found',
  fields: { gender: 'female', typed_text: 'bachi mili hai naam Ayesha, abu ka naam Kamran, 7 saal, gulabi frock', lat: 30.2001, lng: 71.4691 },
})
await waitFor('extract G', async () => (await caseRow(foundG.case.id)).ai_status !== 'pending')
await call(finder, 'case-transition', { case_id: foundG.case.id, event: 'safe_point_chosen', safe_point_id: SHRINE_GATE })
await call(femaleStaff, 'case-transition', { case_id: foundG.case.id, event: 'safe_point_accepted' })
const mG = await waitFor('match G', async () => {
  const r = (await service.from('matches').select('*').eq('found_case_id', foundG.case.id).eq('lost_case_id', lostG.case.id).maybeSingle()).data
  return r && (await caseRow(foundG.case.id)).status === 'matched' ? r : null
})
check('girl matched at the Behan Desk', !!mG, mG)
await call(finder, 'match-decision', { match_id: mG.id, decision: 'confirm' })
await call(femaleStaff, 'handover', { match_id: mG.id, action: 'start' })
const blocked = await call(femaleStaff, 'handover', { match_id: mG.id, action: 'complete', result: 'failed', reason: 'Child did not recognise the adult', checklist: { child_reaction_ok: false } })
check('"Something\'s wrong" -> handover_blocked', blocked.ok && blocked.status === 'handover_blocked', blocked)
check('police URGENT on failed verification (R5)', (await policeOf(foundG.case.id)) === 'URGENT: verification failed')
const pflags = (await service.from('profiles').select('flags').eq('id', parent.uid).single()).data.flags
check('parent flagged verification_failed (never auto-punished)', pflags.includes('verification_failed'), pflags)

console.log('\n— Under-4 (R11) + escalation + tick —')
const tiny = await call(finder, 'create-case', { kind: 'found', fields: { gender: 'male', under_4: true, lat: 30.1978, lng: 71.4698 } })
await call(finder, 'case-transition', { case_id: tiny.case.id, event: 'safe_point_chosen', safe_point_id: GHANTA_GHAR })
await call(maleStaff, 'case-transition', { case_id: tiny.case.id, event: 'safe_point_accepted' })
await service.from('cases').update({ escalate_at: new Date(Date.now() - 1000).toISOString() }).eq('id', tiny.case.id)
const tick = await fetch(`${url}/functions/v1/tick`, { method: 'POST', body: '{}' }).then((r) => r.json())
check('tick runs without a key and escalates the overdue case', tick.ok && tick.escalated >= 1, tick)
check('police: Active takeover (R5)', (await policeOf(tiny.case.id)) === 'Active takeover')
const tick2 = await fetch(`${url}/functions/v1/tick`, { method: 'POST', body: '{}' }).then((r) => r.json())
check('tick is idempotent', tick2.escalated === 0, tick2)

const reveal0 = await call(police, 'media-url', { case_id: fid })
check('police must explicitly reveal photos', reveal0.error === 'reveal_required', reveal0)
const reveal = await call(police, 'media-url', { case_id: fid, reveal: true })
check('police reveal works and is audited', reveal.ok && !!(await service.from('audit_log').select('id').eq('action', 'media.police_reveal').eq('case_id', fid).limit(1)).data?.length, reveal)

const rep = await call(admin, 'event-report', {})
check('event report from aggregates', rep.ok && rep.report?.headline && rep.stats?.reunions >= 1, rep)
const notAdmin = await call(parent, 'event-report', {})
check('event report is admin-only', notAdmin.status === 403, notAdmin)

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll P2–P5 checks passed')
process.exit(failures ? 1 : 0)
