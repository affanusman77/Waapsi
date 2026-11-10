// Seeds the demo story (spec section 14/15) through the real API: a gate check-in for "Ali"
// (boy, ~5, red shirt, parent 0300-0000002) and a found child at Ghanta Ghar Help Desk whose
// match is waiting for the finder's decision. Run: node --env-file=.env.local scripts/demo-scenario.mjs
import zlib from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const pw = process.env.DEMO_USER_PASSWORD
const GHANTA_GHAR = '00000000-0000-4000-a000-000000000002'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function as(phone) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email: `${phone}@demo.wapsi.app`, password: pw })
  if (error) throw error
  c.uid = data.user.id
  return c
}
async function call(c, fn, body) {
  const { data, error } = await c.functions.invoke(fn, { body })
  if (error) throw new Error(`${fn}: ${(await error.context?.json?.().catch(() => null))?.error ?? error.message}`)
  return data
}
/** Tiny PNG encoder: a placeholder "child in a red shirt" so the demo seed has real images. */
function placeholderPng(bg) {
  const w = 120, h = 160
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const head = (x - 60) ** 2 + (y - 55) ** 2 < 28 ** 2
      const shirt = y > 92 && x > 28 && x < 92
      const [r, g, b] = head ? [243, 210, 179] : shirt ? [198, 40, 40] : bg
      raw.set([r, g, b, 255], y * (w * 4 + 1) + 1 + x * 4)
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
async function photo(c, bg) {
  const path = `${c.uid}/${crypto.randomUUID()}.png`
  const { error } = await c.storage.from('case-photos').upload(path, new Blob([placeholderPng(bg)], { type: 'image/png' }))
  if (error) throw error
  return path
}

const [finder, parent, staff] = await Promise.all(['923000000001', '923000000002', '923000000004'].map(as))
const ci = await call(parent, 'create-case', {
  kind: 'checkin',
  fields: { child_name: 'Aly', father_name: 'Rza', age_est: 5, gender: 'male', top_color: 'red', top_type: 'shirt', lat: 30.2002, lng: 71.469, photo_path: await photo(parent, [120, 170, 210]) },
})
const found = await call(finder, 'create-case', {
  kind: 'found',
  fields: {
    gender: 'male',
    typed_text: 'Ye bacha mila hai, naam Ali bata raha, abu ka naam Raza, Hussain Agahi ke paas. 5 saal, laal shirt.',
    lat: 30.1962,
    lng: 71.4738,
    photo_path: await photo(finder, [225, 205, 170]),
  },
})
await sleep(4000)
await call(finder, 'case-transition', { case_id: found.case.id, event: 'safe_point_chosen', safe_point_id: GHANTA_GHAR })
await call(staff, 'case-transition', { case_id: found.case.id, event: 'safe_point_accepted' })
await sleep(3000)
console.log(JSON.stringify({ checkin: ci.case.id, found: found.case.id }))
