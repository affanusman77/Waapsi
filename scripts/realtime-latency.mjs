// P1 "done when": a new found case appears for admin AND police within 2 s via Realtime.
// Run: node --env-file=.env.local scripts/realtime-latency.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const pw = process.env.DEMO_USER_PASSWORD

async function as(phone) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: `${phone}@demo.wapsi.app`, password: pw })
  if (error) throw error
  c.realtime.setAuth((await c.auth.getSession()).data.session.access_token)
  return c
}

function waitForInsert(client, label) {
  return new Promise((resolve, reject) => {
    const ch = client
      .channel(`lat-${label}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cases' }, (p) => resolve({ at: Date.now(), id: p.new.id }))
      .subscribe((s) => s === 'SUBSCRIBED' && ch.__ready?.())
    ch.__ready = () => {}
    setTimeout(() => reject(new Error(`${label}: no event within 10 s`)), 15_000)
    return ch
  })
}

const [finder, admin, police] = await Promise.all([as('923000000001'), as('923000000005'), as('923000000006')])
const adminP = waitForInsert(admin, 'admin')
const policeP = waitForInsert(police, 'police')
await new Promise((r) => setTimeout(r, 2500)) // let both subscriptions join

const t0 = Date.now()
const { data, error } = await finder.functions.invoke('create-case', {
  body: { kind: 'found', fields: { gender: 'male', lat: 30.1979, lng: 71.47, typed_text: 'latency test' } },
})
if (error) throw error
const tReturn = Date.now()
const [a, p] = await Promise.all([adminP, policeP])
console.log(`create-case round trip: ${tReturn - t0} ms; event vs return: admin ${a.at - tReturn} ms, police ${p.at - tReturn} ms`)
const ms = (x) => x.at - t0
console.log(`create-case returned in ${data ? 'ok' : '?'}; admin saw it after ${ms(a)} ms, police after ${ms(p)} ms`)
const ok = ms(a) < 2000 && ms(p) < 2000 && a.id === data.case.id
console.log(ok ? '✓ within 2 s' : '✗ slower than 2 s')
process.exit(ok ? 0 : 1)
