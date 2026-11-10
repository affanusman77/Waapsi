// F2: admin onboards safe point staff by phone. Creates the account if needed and assigns it to a
// safe point. Gender matters for the girls' protocol (R4: female staff must be present).
import { adminClient, getCaller, handle, HttpError, json, normalizePkPhone } from '../_shared/http.ts'
import { audit } from '../_shared/audit.ts'

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    if (caller.role !== 'admin') throw new HttpError(403, 'admin_only')

    const phone = normalizePkPhone(body.phone)
    if (!phone) throw new HttpError(400, 'invalid_phone')
    const gender = body.gender === 'male' || body.gender === 'female' ? body.gender : null
    if (!gender) throw new HttpError(400, 'gender_required')
    const name = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 60) : null
    const spId = typeof body.safe_point_id === 'string' ? body.safe_point_id : null
    const { data: sp } = spId ? await admin.from('safe_points').select('id').eq('id', spId).maybeSingle() : { data: null }
    if (!sp) throw new HttpError(404, 'safe_point_not_found')

    const { data: existing } = await admin.from('profiles').select('id, role').eq('phone', phone).maybeSingle()
    let id = existing?.id as string | undefined
    if (existing && !['sp_staff', 'finder'].includes(existing.role)) throw new HttpError(409, 'phone_in_use')
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `${phone.replace(/\D/g, '')}@demo.wapsi.app`,
        email_confirm: true,
        phone: phone.slice(1),
        phone_confirm: true,
      })
      if (error || !data.user) throw new HttpError(500, 'signup_failed', error?.message)
      id = data.user.id
    }
    const { error } = await admin.from('profiles').upsert({ id, phone, role: 'sp_staff', gender, display_name: name, safe_point_id: sp.id })
    if (error) throw new HttpError(500, 'profile_failed', error.message)
    await audit(admin, { action: 'admin.staff_assigned', actor: { type: 'human', id: caller.id }, payload: { safe_point_id: sp.id, gender } })
    return json({ ok: true, id })
  }),
)
