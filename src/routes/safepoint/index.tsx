import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, HandHeart, Megaphone } from 'lucide-react'
import { RequireRole, SignedInAs } from '../../components/RequireRole'
import { Button } from '../../components/Button'
import { CasePhoto, EscalationCountdown, formatDuration, StatusChip, useNow } from '../../components/CaseBits'
import { ColourSwatch } from '../../components/CaseCard'
import { MatchReview } from '../../components/MatchReview'
import { HandoverChecklist } from '../../components/HandoverChecklist'
import { Chat } from '../../components/Chat'
import { ReunitedMoment } from '../../components/Reunited'
import { Notice, PageHeader } from '../../components/ui'
import { NearbyAlerts } from '../../components/NearbyAlerts'
import { useI18n } from '../../i18n'
import { callFn, errorKey } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useSession } from '../../lib/session'
import { useSafePoints } from '../../lib/useSafePoints'
import { CASE_COLUMNS, shortId, type CaseRow } from '../../lib/useLiveCase'
import { useFinderMatches, type FinderMatch } from '../../lib/useMatches'

const OPEN_STATUSES = ['awaiting_safe_point', 'at_safe_point', 'matched', 'finder_confirmed', 'verifying', 'escalated_police', 'handover_blocked', 'reunited']

export default function SafePoint() {
  return (
    <RequireRole roles={['sp_staff', 'admin']}>
      <Desk />
      <SignedInAs />
    </RequireRole>
  )
}

function Desk() {
  const { t, lang } = useI18n()
  const { profile } = useSession()
  const { state } = useSafePoints()
  const [cases, setCases] = useState<CaseRow[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const sp = state.status === 'ready' ? state.points.find((p) => p.id === profile?.safe_point_id) : undefined

  // RLS already limits staff to their own safe point; admin sees every desk.
  const load = useCallback(async () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString()
    const { data, error } = await supabase
      .from('cases')
      .select(CASE_COLUMNS)
      .eq('kind', 'found')
      .in('status', OPEN_STATUSES)
      .not('safe_point_id', 'is', null)
      .or(`status.neq.reunited,reunited_at.gte.${recent}`)
      .order('created_at', { ascending: true })
    setLoadError(!!error)
    if (!error) setCases(data as CaseRow[])
  }, [])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel('sp-cases')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [load])

  const ids = (cases ?? []).filter((c) => c.status !== 'awaiting_safe_point').map((c) => c.id)
  const { rows: matches, reload: reloadMatches } = useFinderMatches(ids)
  // On the way = not yet accepted (also a child still coming after a police takeover).
  const onTheWay = (c: CaseRow) =>
    c.status === 'awaiting_safe_point' || (c.status === 'escalated_police' && !c.flags?.includes('in_custody') && !matches.some((m) => m.found_case_id === c.id))
  const incoming = cases?.filter(onTheWay) ?? []
  const here = cases?.filter((c) => !onTheWay(c)) ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title={sp ? (lang === 'ur' && sp.name_ur ? sp.name_ur : sp.name_en) : t('sp.title')}
        lead={sp?.women_staff ? `♀ ${t('brand.womenDesk')} · ${t('sp.lead')}` : t('sp.lead')}
      />
      {loadError && <Notice tone="danger">{t('errors.network_error')}</Notice>}
      <NearbyAlerts mode="sp" />
      {cases === null && !loadError && <div className="h-40 animate-pulse rounded-2xl bg-sand" aria-label={t('common.loading')} />}

      {cases && (
        <>
          <section>
            <h2 className="mb-3 text-xl font-bold">{t('sp.incoming', { n: incoming.length })}</h2>
            {incoming.length === 0 ? <p className="text-ink-soft">{t('sp.noneIncoming')}</p> : (
              <ul className="space-y-3">{incoming.map((c) => <SpCase key={c.id} c={c} matches={[]} onChange={reloadMatches} />)}</ul>
            )}
          </section>
          <section>
            <h2 className="mb-3 text-xl font-bold">{t('sp.here', { n: here.length })}</h2>
            {here.length === 0 ? <p className="text-ink-soft">{t('sp.noneHere')}</p> : (
              <ul className="space-y-3">
                {here.map((c) => <SpCase key={c.id} c={c} matches={matches.filter((m) => m.found_case_id === c.id)} onChange={reloadMatches} />)}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function SpCase({ c, matches, onChange }: { c: CaseRow; matches: FinderMatch[]; onChange: () => void }) {
  const { t, lang } = useI18n()
  const now = useNow()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waited = (now - new Date(c.created_at).getTime()) / 1000
  const under4 = c.flags?.includes('under_4')
  const suggested = matches.find((m) => m.match_status === 'suggested')
  const confirmed = matches.find((m) => m.match_status === 'finder_confirmed')
  const summary = lang === 'ur' ? c.ai_extract?.summary_ur : c.ai_extract?.summary_en
  const danger = c.status === 'escalated_police' || c.status === 'handover_blocked'

  async function run(fn: string, body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await callFn(fn, body)
      onChange()
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(false)
    }
  }

  if (c.status === 'reunited' && c.reunited_at) {
    return <li><ReunitedMoment fromIso={c.created_at} toIso={c.reunited_at} compact /></li>
  }

  return (
    <li className={`overflow-hidden rounded-2xl border-2 bg-sand ${danger ? 'border-danger' : 'border-sand-deep'}`}>
      <div className="flex gap-4 p-4">
        <CasePhoto caseId={c.id} className="size-24 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold" dir="ltr">#{shortId(c.id)}</span>
            <StatusChip status={c.status} />
          </div>
          <p className="font-semibold">
            {[c.child_name, c.gender ? t(`finder.about.${c.gender}`) : null, c.age_est != null ? t('sp.age', { n: c.age_est }) : null].filter(Boolean).join(' · ') || t('sp.detailsPending')}
          </p>
          {c.clothing?.top_color && (
            <p className="flex items-center gap-1 text-sm"><ColourSwatch c={c.clothing.top_color} /> {t(`colours.${c.clothing.top_color}`)} {c.clothing.top_type ?? ''}</p>
          )}
          {under4 && <p className="font-bold text-terracotta">{t('sp.under4')}</p>}
          <p className="text-ink-soft tabular-nums">{t('sp.waiting', { t: formatDuration(waited) })}</p>
          <EscalationCountdown escalateAt={c.escalate_at} status={c.status} />
        </div>
      </div>
      {(summary || c.transcript) && <p className="border-t border-sand-deep px-4 py-3 text-ink-soft">{summary ?? `“${c.transcript}”`}</p>}

      <div className="space-y-4 border-t border-sand-deep p-4 empty:hidden">
        {(c.status === 'awaiting_safe_point' || (c.status === 'escalated_police' && !c.flags?.includes('in_custody') && !suggested && !confirmed)) && (
          <Button busy={busy} icon={<HandHeart className="size-6" aria-hidden />} onClick={() => void run('case-transition', { case_id: c.id, event: 'safe_point_accepted' })}>
            {t('sp.accept')}
          </Button>
        )}

        {suggested && (
          <>
            {!under4 && <Notice>{t('sp.finderDecides')}</Notice>}
            <MatchReview m={suggested} showChildPhoto onDecided={onChange} />
          </>
        )}

        {confirmed && c.status === 'finder_confirmed' && (
          <>
            <Notice>{t('sp.parentComing')}</Notice>
            <Button busy={busy} icon={<ClipboardCheck className="size-6" aria-hidden />} onClick={() => void run('handover', { match_id: confirmed.match_id, action: 'start' })}>
              {t('sp.startCheck')}
            </Button>
          </>
        )}

        {confirmed && c.status === 'verifying' && (
          <>
            <MatchReview m={confirmed} showChildPhoto />
            <HandoverChecklist matchId={confirmed.match_id} girl={c.gender === 'female' || confirmed.lost_gender === 'female'} under4={!!under4} onDone={onChange} />
          </>
        )}

        {confirmed && <Chat matchId={confirmed.match_id} />}

        {c.status === 'at_safe_point' && !suggested && <p className="flex items-center gap-2 text-ink-soft"><Megaphone className="size-5" aria-hidden />{t('sp.searching')}</p>}
        {error && <Notice tone="danger">{t(error)}</Notice>}
      </div>
    </li>
  )
}
