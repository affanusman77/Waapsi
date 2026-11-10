// Masked chat (R8): finder <-> parent (staff can read and write, and replace the finder for
// under-4s, R11). Opens only after the finder confirmed. Phone numbers are masked and flagged.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { isStaffAt, loadMatch } from '../_shared/access.ts'
import { audit } from '../_shared/audit.ts'

const OPEN = new Set(['finder_confirmed'])
// Pakistani mobiles in any format, plus any long digit run (incl. Urdu digits).
const PHONE = /(?:\+?92|0)?[\s-]*3\d{2}[\s-]*\d{7}|[0-9۰-۹٠-٩][0-9۰-۹٠-٩\s-]{6,}[0-9۰-۹٠-٩]/g

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const m = await loadMatch(admin, body.match_id)
    const under4 = m.found.flags?.includes('under_4')
    const party =
      caller.role === 'admin' ||
      m.lost.reporter_id === caller.id ||
      isStaffAt(caller, m.found.safe_point_id) ||
      (m.found.reporter_id === caller.id && !under4)
    if (!party) throw new HttpError(403, 'not_allowed')
    if (!OPEN.has(m.status)) throw new HttpError(409, 'chat_closed')

    const raw = typeof body.body === 'string' ? body.body.trim().slice(0, 1000) : ''
    if (!raw) throw new HttpError(400, 'empty_message')
    const masked = raw.replace(PHONE, '[•••]')
    if (masked !== raw) {
      const { data: p } = await admin.from('profiles').select('flags').eq('id', caller.id).single()
      await admin.from('profiles').update({ flags: [...new Set([...(p?.flags ?? []), 'contact_share_attempt'])] }).eq('id', caller.id)
      await audit(admin, { action: 'flag.contact_share_attempt', actor: { type: 'system' }, matchId: m.id, caseId: m.found.id, payload: { sender_role: caller.role } })
    }
    const { data, error } = await admin.from('messages').insert({ match_id: m.id, sender_id: caller.id, body: masked }).select('id, created_at').single()
    if (error) throw new HttpError(500, 'send_failed', error.message)
    return json({ message: { id: data.id, body: masked, masked: masked !== raw } })
  }),
)
