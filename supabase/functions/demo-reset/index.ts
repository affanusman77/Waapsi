// Admin "Reset demo" (DEMO_MODE only): deletes all cases (and, by cascade, their police records,
// matches, messages and handovers), the audit log, and case media. Keeps safe points, accounts
// and saved child profiles. Refuses outside DEMO_MODE so it can never wipe a real deployment.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { audit } from '../_shared/audit.ts'
import { demoMode } from '../_shared/settings.ts'

Deno.serve(
  handle(async (req) => {
    const admin = adminClient()
    if (!(await demoMode(admin))) throw new HttpError(403, 'demo_disabled')
    const caller = await getCaller(req, admin)
    if (caller.role !== 'admin') throw new HttpError(403, 'admin_only')

    const { count: cases } = await admin.from('cases').delete({ count: 'exact' }).not('id', 'is', null)
    await admin.from('audit_log').delete().gte('id', 0)
    let files = 0
    for (const bucket of ['case-photos', 'wrist-photos', 'voice-notes', 'announcements']) {
      const { data: folders } = await admin.storage.from(bucket).list('', { limit: 1000 })
      for (const folder of folders ?? []) {
        const { data: objs } = await admin.storage.from(bucket).list(folder.name, { limit: 1000 })
        const paths = (objs ?? []).map((o) => `${folder.name}/${o.name}`)
        if (paths.length) {
          await admin.storage.from(bucket).remove(paths)
          files += paths.length
        }
      }
    }
    await admin.from('profiles').update({ flags: [] }).not('id', 'is', null)
    await audit(admin, { action: 'admin.demo_reset', actor: { type: 'human', id: caller.id }, payload: { cases, files } })
    return json({ ok: true, cases, files })
  }),
)
