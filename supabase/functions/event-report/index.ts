// Organiser insight report. Only AGGREGATE counts are computed and sent to the model (no PII).
// Without AI, the raw stats are returned with a plain summary (R6).
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { aiConfigured, chatJSON } from '../_shared/ai.ts'
import { audit } from '../_shared/audit.ts'
import { EVENT_REPORT_SYSTEM } from '../_shared/prompts.ts'

Deno.serve(
  handle(async (req) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    if (caller.role !== 'admin') throw new HttpError(403, 'admin_only')

    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const [{ data: cases }, { data: sps }] = await Promise.all([
      admin.from('cases').select('kind, status, created_at, reunited_at, safe_point_id, flags').gte('created_at', since).limit(5000),
      admin.from('safe_points').select('id, name_en'),
    ])
    const rows = cases ?? []
    const by = (f: (r: (typeof rows)[number]) => string) => rows.reduce<Record<string, number>>((a, r) => ((a[f(r)] = (a[f(r)] ?? 0) + 1), a), {})
    const reunionSecs = rows
      .filter((r) => r.kind === 'found' && r.reunited_at)
      .map((r) => (Date.parse(r.reunited_at!) - Date.parse(r.created_at)) / 1000)
      .sort((a, b) => a - b)
    const median = reunionSecs.length ? Math.round(reunionSecs[Math.floor(reunionSecs.length / 2)]) : null
    const spName = Object.fromEntries((sps ?? []).map((s) => [s.id, s.name_en]))
    const stats = {
      window: 'last 24 hours',
      reports_by_kind: by((r) => r.kind),
      cases_by_status: by((r) => r.status),
      found_children_per_safe_point: Object.fromEntries(
        Object.entries(by((r) => (r.kind === 'found' && r.safe_point_id ? spName[r.safe_point_id] ?? 'unknown' : '-'))).filter(([k]) => k !== '-'),
      ),
      reports_per_hour: by((r) => `${new Date(r.created_at).getUTCHours() + 5}:00 PKT`),
      reunions: reunionSecs.length,
      median_reunion_minutes: median !== null ? Math.round(median / 6) / 10 : null,
      escalated_to_police: rows.filter((r) => r.status === 'escalated_police').length,
      flags: rows.flatMap((r) => r.flags ?? []).reduce<Record<string, number>>((a, f) => ((a[f] = (a[f] ?? 0) + 1), a), {}),
    }

    let report: { headline: string; bullets: string[]; source: 'ai' | 'stats' } = {
      headline: `${stats.reunions} reunions, ${stats.escalated_to_police} escalations in the last 24 hours`,
      bullets: [
        `Reports: ${Object.entries(stats.reports_by_kind).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}.`,
        stats.median_reunion_minutes !== null ? `Median time from report to reunion: ${stats.median_reunion_minutes} min.` : 'No reunions yet.',
        `Busiest safe point: ${Object.entries(stats.found_children_per_safe_point).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none'}.`,
      ],
      source: 'stats',
    }
    if (aiConfigured()) {
      try {
        const r = (await chatJSON(EVENT_REPORT_SYSTEM, JSON.stringify(stats), { timeoutMs: 15_000 })) as { headline?: string; bullets?: unknown[] }
        if (typeof r.headline === 'string' && Array.isArray(r.bullets)) {
          report = { headline: r.headline.slice(0, 160), bullets: r.bullets.map(String).slice(0, 6), source: 'ai' }
        }
      } catch {
        /* keep stats report */
      }
    }
    await audit(admin, { action: 'admin.event_report', actor: { type: report.source === 'ai' ? 'ai' : 'system' }, payload: { source: report.source } })
    return json({ report, stats })
  }),
)
