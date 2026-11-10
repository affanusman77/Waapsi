// Supabase-backed TransitionStore (service role). The only code that writes cases.status.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { policeStatusFor, type TransitionStore } from './state.ts'
import { audit } from './audit.ts'
import { notifyLater, notifyTransition } from './whatsapp.ts'

export function supabaseStore(admin: SupabaseClient): TransitionStore {
  return {
    async updateCase(caseId, expected, next, patch) {
      const { data, error } = await admin
        .from('cases')
        .update({ ...patch, status: next.status, kind: next.kind })
        .eq('id', caseId)
        .eq('status', expected) // optimistic lock: lose the race -> no row -> false
        .select('id')
      if (error) throw error
      const ok = (data?.length ?? 0) > 0
      // F3: WhatsApp alerts (police every custody step, safe point incoming, parent updates). Fail open.
      if (ok) notifyLater(notifyTransition(admin, caseId, next.status, policeStatusFor(next.status)))
      return ok
    },
    async setPoliceStatus(caseId, status) {
      const { error } = await admin.from('police_records').update({ status }).eq('case_id', caseId)
      if (error) throw error
      await audit(admin, { action: 'police.status_changed', actor: { type: 'system' }, caseId, payload: { status } })
    },
    async audit(e) {
      await audit(admin, { action: e.action, actor: e.actor, caseId: e.caseId, payload: e.payload })
    },
  }
}
