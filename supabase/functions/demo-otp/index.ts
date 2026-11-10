// DEMO_MODE phone "OTP": accepts code 123456 for any Pakistani mobile number, creates the
// account on first use, and returns a one-time magic-link token hash that the browser
// exchanges for a session (supabase.auth.verifyOtp). No SMS provider needed for the demo.
// When DEMO_MODE is not "true" this function refuses every request.
import { adminClient, handle, HttpError, json, normalizePkPhone } from '../_shared/http.ts'
import { audit } from '../_shared/audit.ts'
import { demoMode } from '../_shared/settings.ts'

const DEMO_CODE = '123456'
const PUBLIC_ROLES = new Set(['finder', 'parent'])

const demoEmail = (phone: string) => `${phone.replace(/\D/g, '')}@demo.wapsi.app`

Deno.serve(
  handle(async (_req, body) => {

    const phone = normalizePkPhone(body.phone)
    if (!phone) throw new HttpError(400, 'invalid_phone')
    if (body.code !== DEMO_CODE) throw new HttpError(400, 'wrong_code')
    const roleHint = PUBLIC_ROLES.has(String(body.role_hint)) ? String(body.role_hint) : 'finder'

    const admin = adminClient()
    if (!(await demoMode(admin))) throw new HttpError(403, 'demo_disabled')
    let { data: profile } = await admin.from('profiles').select('id, role').eq('phone', phone).maybeSingle()
    let email: string

    if (profile) {
      const { data, error } = await admin.auth.admin.getUserById(profile.id)
      if (error || !data.user?.email) throw new HttpError(500, 'user_lookup_failed', error?.message)
      email = data.user.email
    } else {
      // New member of the public: finders and parents only. Staff/admin/police are provisioned.
      email = demoEmail(phone)
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        phone: phone.slice(1),
        phone_confirm: true,
        user_metadata: { demo: true },
      })
      if (error || !data.user) throw new HttpError(500, 'signup_failed', error?.message)
      const { error: pErr } = await admin.from('profiles').insert({ id: data.user.id, phone, role: roleHint })
      if (pErr) throw new HttpError(500, 'profile_failed', pErr.message)
      profile = { id: data.user.id, role: roleHint }
      await audit(admin, { action: 'auth.signed_up', actor: { type: 'system' }, payload: { role: roleHint } })
    }

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (linkErr || !link.properties?.hashed_token) throw new HttpError(500, 'link_failed', linkErr?.message)

    return json({ token_hash: link.properties.hashed_token, role: profile.role })
  }),
)
