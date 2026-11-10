import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Bot, Cog, FileBarChart, Flag, Play, RotateCcw, User } from 'lucide-react'
import { Notice } from '../../components/ui'
import { Button } from '../../components/Button'
import { RequireRole, SignedInAs } from '../../components/RequireRole'
import { EscalationCountdown, formatDuration, StatusChip, useNow } from '../../components/CaseBits'
import { formatReunion } from '../../components/Reunited'
import { useI18n } from '../../i18n'
import { callFn, errorKey } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useSafePoints } from '../../lib/useSafePoints'
import { useControlFeed, type AuditRow } from '../../lib/useLiveCases'
import { shortId, type CaseRow } from '../../lib/useLiveCase'
import { flags } from '../../config/flags'
import { SafePointsAdmin } from './SafePointsAdmin'

const SafePointMap = lazy(() => import('../../components/SafePointMap').then((m) => ({ default: m.SafePointMap })))

const OPEN = new Set(['reported', 'awaiting_safe_point', 'at_safe_point', 'matched', 'finder_confirmed', 'verifying', 'escalated_police'])
const ABUSE_FLAGS = new Set(['multi_claim', 'frequent_finder', 'low_detail_fast_claim', 'girl_at_non_behan_point', 'zarra_notified', 'location_approx'])

export default function Admin() {
  return (
    <RequireRole roles={['admin']}>
      <ControlRoom />
      <SignedInAs />
    </RequireRole>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'danger' | 'reunited' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'reunited' ? 'text-reunited' : ''
  return (
    <div className="rounded-2xl border border-sand-deep bg-sand p-4">
      <p className="font-medium text-ink-soft">{label}</p>
      <p className={`mt-1 text-4xl font-extrabold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

/** Runs `tick` on load and every 20 s while the control room is open (pg_cron also runs it every minute). */
function useTick() {
  const [last, setLast] = useState<{ at: string; time_scale: number; escalated: number; expired: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async () => {
    setBusy(true)
    try {
      setLast(await callFn('tick', {}))
    } catch {
      /* cron will catch up */
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void run()
    const id = window.setInterval(() => document.visibilityState === 'visible' && void run(), 20_000)
    return () => window.clearInterval(id)
  }, [run])
  return { last, busy, run }
}

function ControlRoom() {
  const { t } = useI18n()
  const { state } = useSafePoints()
  const { cases, police, audit, error } = useControlFeed()
  const tick = useTick()
  const points = state.status === 'ready' ? state.points : []
  const today = new Date().toDateString()
  const found = cases?.filter((c) => c.kind === 'found') ?? []
  const open = cases?.filter((c) => OPEN.has(c.status)) ?? []
  const escalated = cases?.filter((c) => c.status === 'escalated_police').length ?? 0
  const reunions = found.filter((c) => c.status === 'reunited' && c.reunited_at).sort((a, b) => Date.parse(b.reunited_at!) - Date.parse(a.reunited_at!))
  const reunitedToday = reunions.filter((c) => new Date(c.reunited_at!).toDateString() === today).length
  const latest = reunions[0]
  const dash = cases ? 0 : '…'

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight">{t('admin.title')}</h1>
        {tick.last && tick.last.time_scale !== 1 && (
          <span className="rounded-full bg-ink px-3 py-1 text-sm font-bold text-cream">{t('admin.timeScale', { n: tick.last.time_scale })}</span>
        )}
        <div className="ms-auto flex gap-2">
          <button type="button" onClick={() => void tick.run()} disabled={tick.busy} className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-sand-deep px-4 font-semibold hover:bg-sand disabled:opacity-50">
            <Play className="size-4" aria-hidden /> {t('admin.runTick')}
          </button>
        </div>
      </div>
      {error && <div className="mb-4"><Notice tone="danger">{t('errors.network_error')}</Notice></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.openCases')} value={cases ? open.length : dash} />
        <Stat label={t('admin.escalated')} value={cases ? escalated : dash} tone={escalated ? 'danger' : undefined} />
        <Stat label={t('admin.reunitedToday')} value={cases ? reunitedToday : dash} tone="reunited" />
        <Stat label={t('admin.safePoints')} value={state.status === 'ready' ? `${points.length} · ♀${points.filter((p) => p.women_staff).length}` : '…'} />
      </div>

      {latest && (
        <section className="reunited-glow relative mb-4 overflow-hidden rounded-3xl bg-reunited-soft p-6 text-center" aria-live="polite">
          <p className="relative font-bold text-reunited">{t('admin.latestReunion', { id: shortId(latest.id) })}</p>
          <p className="relative text-5xl font-extrabold tabular-nums text-reunited sm:text-6xl">
            {formatReunion((Date.parse(latest.reunited_at!) - Date.parse(latest.created_at)) / 1000, t)}
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <Suspense fallback={<div className="h-[60vh] min-h-80 animate-pulse rounded-2xl bg-sand" aria-label={t('common.loading')} />}>
          <SafePointMap points={points} cases={[...open, ...reunions.slice(0, 5)]} />
        </Suspense>
        <section className="space-y-3">
          <h2 className="text-xl font-bold">{t('admin.liveCases')}</h2>
          {cases && open.length === 0 && <p className="text-ink-soft">{t('admin.noOpenCases')}</p>}
          <ul className="max-h-[52vh] space-y-2 overflow-y-auto">
            {open.map((c) => (
              <CaseLine key={c.id} c={c} policeStatus={police[c.id]?.status} />
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FlagsPanel cases={cases ?? []} />
        <EventReport />
      </div>

      <div className="mt-6">
        <SafePointsAdmin points={points} cases={found} />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-xl font-bold">{t('admin.auditFeed')}</h2>
        <AuditFeed rows={audit} />
      </section>

      {flags.demoMode && <DemoControls />}
    </>
  )
}

function CaseLine({ c, policeStatus }: { c: CaseRow; policeStatus?: string }) {
  const { t } = useI18n()
  const now = useNow()
  return (
    <li className={`rounded-xl border bg-sand p-3 ${c.status === 'escalated_police' ? 'border-danger' : 'border-sand-deep'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-bold" dir="ltr">#{shortId(c.id)}</span>
        <span className="text-sm font-semibold text-ink-soft">{t(`admin.kind_${c.kind}`)}</span>
        <StatusChip status={c.status} />
        <span className="ms-auto font-mono text-sm tabular-nums" title={t('admin.timer')}>{formatDuration((now - Date.parse(c.created_at)) / 1000)}</span>
      </div>
      <p className="mt-1 text-sm">
        {[c.child_name, c.age_est != null && t('sp.age', { n: c.age_est }), c.flags?.includes('under_4') && t('sp.under4')].filter(Boolean).join(' · ')}
      </p>
      <p className="text-sm text-ink-soft">
        {t('police.recordStatus')}: <span className="font-semibold text-ink">{policeStatus ? t(`police.statuses.${policeStatus}`) : '…'}</span>
      </p>
      <EscalationCountdown escalateAt={c.escalate_at} status={c.status} />
    </li>
  )
}

function FlagsPanel({ cases }: { cases: CaseRow[] }) {
  const { t } = useI18n()
  const [people, setPeople] = useState<Array<{ id: string; display_name: string | null; role: string; flags: string[] }>>([])
  useEffect(() => {
    void supabase.from('profiles').select('id, display_name, role, flags').neq('flags', '{}').then(({ data }) => setPeople(data ?? []))
  }, [cases.length])
  const flagged = cases.filter((c) => c.flags?.some((f) => ABUSE_FLAGS.has(f)))

  return (
    <section className="rounded-2xl border border-sand-deep p-4">
      <h2 className="mb-1 flex items-center gap-2 text-xl font-bold"><Flag className="size-5" aria-hidden /> {t('admin.flags')}</h2>
      <p className="mb-3 text-sm text-ink-soft">{t('admin.flagsNote')}</p>
      {!flagged.length && !people.length && <p className="text-ink-soft">{t('admin.noFlags')}</p>}
      <ul className="space-y-2">
        {flagged.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-bold" dir="ltr">#{shortId(c.id)}</span>
            {c.flags.filter((f) => ABUSE_FLAGS.has(f)).map((f) => (
              <span key={f} className="rounded-full bg-sand-deep px-2 py-0.5 font-semibold">{t(`flags.${f}`)}</span>
            ))}
          </li>
        ))}
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{p.display_name ?? t(`roles.${p.role}`)}</span>
            {p.flags.map((f) => (
              <span key={f} className="rounded-full bg-danger-soft px-2 py-0.5 font-semibold text-danger">{t(`flags.${f}`)}</span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

function EventReport() {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<{ headline: string; bullets: string[]; source: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function run() {
    setBusy(true)
    setError(null)
    try {
      setR((await callFn<{ report: { headline: string; bullets: string[]; source: string } }>('event-report', {})).report)
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-sand-deep p-4">
      <h2 className="flex items-center gap-2 text-xl font-bold"><FileBarChart className="size-5" aria-hidden /> {t('admin.report')}</h2>
      <p className="text-sm text-ink-soft">{t('admin.reportNote')}</p>
      {r && (
        <div className="space-y-2">
          <p className="text-lg font-bold">{r.headline}</p>
          <ul className="list-disc space-y-1 ps-5">{r.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
          <p className="text-xs text-ink-soft">{r.source === 'ai' ? t('card.byAi') : t('admin.rawStats')}</p>
        </div>
      )}
      {error && <Notice tone="danger">{t(error)}</Notice>}
      <Button variant="secondary" busy={busy} onClick={() => void run()}>{t('admin.generateReport')}</Button>
    </section>
  )
}

function DemoControls() {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function reset() {
    if (!window.confirm(t('admin.resetConfirm'))) return
    setBusy(true)
    try {
      const r = await callFn<{ cases: number }>('demo-reset', {})
      setMsg(t('admin.resetDone', { n: r.cases ?? 0 }))
    } catch (e) {
      setMsg(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mt-6 space-y-3 rounded-2xl border-2 border-dashed border-sand-deep p-4">
      <h2 className="text-lg font-bold">{t('admin.demoControls')}</h2>
      {msg && <Notice>{msg}</Notice>}
      <div className="max-w-xs">
        <Button variant="secondary" busy={busy} icon={<RotateCcw className="size-5" aria-hidden />} onClick={() => void reset()}>{t('admin.resetDemo')}</Button>
      </div>
    </section>
  )
}

const ACTOR_ICON = { human: User, ai: Bot, system: Cog } as const

export function AuditFeed({ rows }: { rows: AuditRow[] }) {
  const { t, lang } = useI18n()
  if (rows.length === 0) return <p className="text-ink-soft">{t('admin.noAudit')}</p>
  return (
    <ol className="divide-y divide-sand-deep rounded-2xl border border-sand-deep bg-sand" dir="ltr">
      {rows.map((r) => {
        const Icon = ACTOR_ICON[r.actor]
        return (
          <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <Icon className="size-4 shrink-0 text-ink-soft" aria-label={r.actor} />
            <time className="w-20 shrink-0 tabular-nums text-ink-soft">{new Date(r.created_at).toLocaleTimeString(lang === 'ur' ? 'ur-PK' : 'en-GB')}</time>
            <span className="font-mono font-semibold">{r.action}</span>
            {r.case_id && <span className="ms-auto font-mono text-ink-soft">#{shortId(r.case_id)}</span>}
          </li>
        )
      })}
    </ol>
  )
}
