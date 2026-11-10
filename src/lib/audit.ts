import { supabase } from './supabase'

/**
 * R7: every human decision is audited. The client can't write audit_log directly;
 * this goes through the `log_event` RPC, which stamps actor='human' and actor_id=auth.uid()
 * server-side so a client can't forge who did what. AI and system events are logged by
 * edge functions with the service role (supabase/functions/_shared/audit.ts).
 */
export async function audit(
  action: string,
  opts: { caseId?: string; matchId?: string; payload?: Record<string, unknown> } = {},
): Promise<void> {
  const { error } = await supabase.rpc('log_event', {
    p_action: action,
    p_case_id: opts.caseId ?? null,
    p_match_id: opts.matchId ?? null,
    p_payload: opts.payload ?? {},
  })
  // Auditing must never block a child's report (R6 spirit): log and carry on.
  if (error) console.error('[audit] failed', action, error.message)
}
