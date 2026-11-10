// Scheduler (pg_cron every minute + "Run tick" in the control room). Idempotent: it only acts on
// items that are overdue, so it's safe to call any time (deployed without JWT verification).
//   R5  escalate: open cases past escalate_at -> escalated_police (police: Active takeover)
//   R9  expire:   check-ins past expires_at   -> expired
//       ZARRA:    lost cases unmatched after 2 (scaled) hours -> flag zarra_notified (simulated)
//   R9  retention: closed cases older than 7 days -> flag delete_due (policy shown in MVP)
import { adminClient, corsHeaders, json } from '../_shared/http.ts'
import { audit } from '../_shared/audit.ts'
import { canTransition, transition, type CaseKind, type CaseStatus } from '../_shared/state.ts'
import { supabaseStore } from '../_shared/store.ts'
import { timeScale } from '../_shared/settings.ts'

const SYSTEM = { type: 'system' as const }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const admin = adminClient()
  const store = supabaseStore(admin)
  const now = new Date()
  const scale = await timeScale(admin)
  const out = { escalated: 0, expired: 0, zarra: 0, delete_due: 0 }

  // R5: escalation.
  const { data: due } = await admin
    .from('cases')
    .select('id, kind, status')
    .lt('escalate_at', now.toISOString())
    .in('status', ['reported', 'awaiting_safe_point', 'at_safe_point', 'matched', 'finder_confirmed', 'verifying'])
    .in('kind', ['found', 'lost'])
    .limit(100)
  for (const c of due ?? []) {
    if (!canTransition(c.kind as CaseKind, c.status as CaseStatus, 'escalate', SYSTEM)) continue
    try {
      await transition(store, c as { id: string; kind: CaseKind; status: CaseStatus }, 'escalate', SYSTEM, { reason: 'no reunion within 60 (scaled) minutes' })
      out.escalated++
    } catch {
      /* changed concurrently: next tick */
    }
  }

  // R9: check-in expiry.
  const { data: old } = await admin.from('cases').select('id, kind, status').eq('kind', 'checkin').eq('status', 'reported').lt('expires_at', now.toISOString()).limit(200)
  for (const c of old ?? []) {
    try {
      await transition(store, c as { id: string; kind: CaseKind; status: CaseStatus }, 'expire', SYSTEM)
      out.expired++
    } catch {
      /* next tick */
    }
  }

  // ZARRA flag: lost reports still unmatched after 2 scaled hours. We don't claim legal timelines.
  const zarraBefore = new Date(now.getTime() - (2 * 3600_000) / scale).toISOString()
  const { data: unmatched } = await admin
    .from('cases')
    .select('id, flags')
    .eq('kind', 'lost')
    .in('status', ['reported', 'escalated_police'])
    .lt('created_at', zarraBefore)
    .not('flags', 'cs', '{zarra_notified}')
    .limit(100)
  for (const c of unmatched ?? []) {
    await admin.from('cases').update({ flags: [...(c.flags ?? []), 'zarra_notified'] }).eq('id', c.id)
    await audit(admin, { action: 'police.zarra_notified', actor: SYSTEM, caseId: c.id, payload: { simulated: true } })
    out.zarra++
  }

  // R9: retention flag for closed cases (deletion itself is a manual, audited step).
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString()
  const { data: closed } = await admin
    .from('cases')
    .select('id, flags')
    .in('status', ['reunited', 'closed_no_match', 'expired'])
    .lt('updated_at', weekAgo)
    .not('flags', 'cs', '{delete_due}')
    .limit(200)
  for (const c of closed ?? []) {
    await admin.from('cases').update({ flags: [...(c.flags ?? []), 'delete_due'] }).eq('id', c.id)
    out.delete_due++
  }

  if (Object.values(out).some(Boolean)) await audit(admin, { action: 'system.tick', actor: SYSTEM, payload: out })
  return json({ ok: true, at: now.toISOString(), time_scale: scale, ...out })
})
