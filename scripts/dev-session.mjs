// DEV/TEST ONLY: prints the localStorage entry for a demo account's session, so a browser test can
// start signed in without the demo-otp function. Uses the real demo password (server-only env).
// Usage: node --env-file=.env.local scripts/dev-session.mjs 923000000001
import { createClient } from '@supabase/supabase-js'

const phone = process.argv[2]
const url = process.env.VITE_SUPABASE_URL
const c = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { data, error } = await c.auth.signInWithPassword({ email: `${phone}@demo.wapsi.app`, password: process.env.DEMO_USER_PASSWORD })
if (error) throw error
const ref = new URL(url).hostname.split('.')[0]
console.log(JSON.stringify({ key: `sb-${ref}-auth-token`, value: JSON.stringify(data.session) }))
