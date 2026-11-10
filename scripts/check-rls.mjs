// Smoke-checks RLS against the live project with real demo sessions (spec section 11, rls).
// Run: node --env-file=.env.local scripts/check-rls.mjs   (needs scripts/seed-users.mjs to have run)
// Grows into tests/rls.test.ts once there is data to protect (P3/P4).
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const pw = process.env.DEMO_USER_PASSWORD
const mk = () => createClient(url, anonKey, { auth: { persistSession: false } })

async function as(phone) {
  const c = mk()
  const { error } = await c.auth.signInWithPassword({ email: `${phone}@demo.wapsi.app`, password: pw })
  if (error) throw new Error(`${phone}: ${error.message}`)
  return c
}
const count = async (c, t) => {
  const { data, error } = await c.from(t).select('*')
  return error ? `ERR ${error.code}` : data.length
}

let failures = 0
function expect(label, actual, ok) {
  const pass = ok(actual)
  if (!pass) failures++
  console.log(`${pass ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}`)
}
const denied = (r) => r !== 'ALLOWED'
const errCode = (res) => res.error?.code ?? 'ALLOWED'

const anon = mk()
const parent = await as('923000000002')
const police = await as('923000000006')
const admin = await as('923000000005')
const parentId = (await parent.auth.getUser()).data.user.id

expect('anon reads safe points', await count(anon, 'safe_points'), (n) => n >= 5)
expect('anon reads no profiles', await count(anon, 'profiles'), (n) => n === 0)
expect('anon reads no cases', await count(anon, 'cases'), (n) => n === 0)
expect('anon reads no audit', await count(anon, 'audit_log'), (n) => n === 0)
expect('anon cannot add a safe point', errCode(await anon.from('safe_points').insert({ name_en: 'x', kind: 'shop', lat: 0, lng: 0 })), denied)
expect('anon cannot log_event', errCode(await anon.rpc('log_event', { p_action: 'test.anon' })), denied)

expect('parent reads only own profile', await count(parent, 'profiles'), (n) => n === 1)
expect('parent reads no audit', await count(parent, 'audit_log'), (n) => n === 0)
expect('parent reads no police records', await count(parent, 'police_records'), (n) => n === 0)
expect('parent can log_event', errCode(await parent.rpc('log_event', { p_action: 'test.rls_check', p_payload: { ok: 1 } })), (r) => r === 'ALLOWED')
expect('parent cannot forge audit rows', errCode(await parent.from('audit_log').insert({ actor: 'ai', action: 'x.y' })), denied)
expect('parent cannot insert police records', errCode(await parent.from('police_records').insert({ case_id: parentId })), denied)
expect('parent cannot save a child without consent', errCode(await parent.from('children').insert({ parent_id: parentId, name: 'x' })), denied)
expect('parent cannot change own role', errCode(await parent.from('profiles').update({ role: 'admin' }).eq('id', parentId).select().single()), denied)

expect('police reads all profiles', await count(police, 'profiles'), (n) => n >= 6)
expect('police cannot browse saved child profiles', await count(police, 'children'), (n) => n === 0)

const { data: au } = await admin.from('audit_log').select('actor,action,actor_id').eq('action', 'test.rls_check').limit(1)
expect('admin sees audit, actor stamped server-side', au?.[0], (r) => r?.actor === 'human' && r?.actor_id === parentId)

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll RLS checks passed')
process.exit(failures ? 1 : 0)
