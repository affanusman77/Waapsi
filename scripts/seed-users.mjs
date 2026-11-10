// Creates the 6 demo accounts (spec section 4) via the Auth admin API, plus their profiles.
// Run: npm run seed:users   (reads .env.local; needs SUPABASE_SERVICE_ROLE_KEY + DEMO_USER_PASSWORD)
// Idempotent: existing users are reused and their profile is upserted.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.DEMO_USER_PASSWORD
if (!url || !serviceKey || !password) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DEMO_USER_PASSWORD in .env.local')
  process.exit(1)
}

const SHRINE_GATE = '00000000-0000-4000-a000-000000000001' // Behan Desk
const GHANTA_GHAR = '00000000-0000-4000-a000-000000000002'

export const DEMO_USERS = [
  { phone: '+923000000001', role: 'finder', display_name: 'Demo Finder', gender: 'male' },
  { phone: '+923000000002', role: 'parent', display_name: 'Demo Parent', gender: 'male' },
  { phone: '+923000000003', role: 'sp_staff', display_name: 'Ayesha (Behan Desk)', gender: 'female', safe_point_id: SHRINE_GATE },
  { phone: '+923000000004', role: 'sp_staff', display_name: 'Bilal (Help Desk)', gender: 'male', safe_point_id: GHANTA_GHAR },
  { phone: '+923000000005', role: 'admin', display_name: 'Control Room', gender: null },
  { phone: '+923000000006', role: 'police', display_name: 'Police (simulated)', gender: null },
]

/** Demo accounts sign in with a synthetic email; the phone is the identity shown in the app. */
export const demoEmail = (phone) => `${phone.replace(/\D/g, '')}@demo.wapsi.app`

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function findUserByEmail(email) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email === email)
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}

for (const u of DEMO_USERS) {
  const email = demoEmail(u.phone)
  let user = await findUserByEmail(email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      phone: u.phone.replace('+', ''),
      phone_confirm: true,
      user_metadata: { demo: true },
    })
    if (error) throw new Error(`${u.phone}: ${error.message}`)
    user = data.user
  } else {
    await admin.auth.admin.updateUserById(user.id, { password })
  }

  const { error: pErr } = await admin.from('profiles').upsert({
    id: user.id,
    phone: u.phone,
    role: u.role,
    display_name: u.display_name,
    gender: u.gender,
    safe_point_id: u.safe_point_id ?? null,
  })
  if (pErr) throw new Error(`${u.phone} profile: ${pErr.message}`)
  console.log(`✓ ${u.phone}  ${u.role.padEnd(8)}  ${u.display_name}`)
}
