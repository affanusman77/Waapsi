// R7: audit helper for edge functions (service role). AI and system events are logged here;
// human decisions from the browser go through the `log_event` RPC instead (src/lib/audit.ts).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Actor } from './state.ts'

export type AuditEntry = {
  action: string // e.g. 'case.created', 'ai.extracted', 'match.suggested'
  actor: Actor
  caseId?: string | null
  matchId?: string | null
  payload?: Record<string, unknown>
}

export async function audit(admin: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await admin.from('audit_log').insert({
    action: e.action,
    actor: e.actor.type,
    actor_id: e.actor.id ?? null,
    case_id: e.caseId ?? null,
    match_id: e.matchId ?? null,
    payload: e.payload ?? {},
  })
  // Never let a logging failure lose a child's report (R6); surface it in function logs instead.
  if (error) console.error('[audit] insert failed', e.action, error.message)
}
