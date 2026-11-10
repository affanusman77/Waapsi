// Wipes demo case data (cases -> police records, matches, messages, handovers via cascade)
// and the audit log, and empties the case media buckets. Keeps safe points, users and saved
// child profiles. Run: node --env-file=.env.local scripts/reset-demo.mjs
// (P8 adds an admin "Reset demo" button that does the same through an edge function.)
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { count: cases } = await admin.from('cases').delete({ count: 'exact' }).not('id', 'is', null)
const { count: audit } = await admin.from('audit_log').delete({ count: 'exact' }).gte('id', 0)

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
console.log(`Removed ${cases ?? 0} cases, ${audit ?? 0} audit rows, ${files} media files.`)
