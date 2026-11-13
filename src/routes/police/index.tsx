import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, Eye, Siren } from 'lucide-react'
import { Notice, PageHeader } from '../../components/ui'
import { NearbyAlerts } from '../../components/NearbyAlerts'
import { RequireRole, SignedInAs } from '../../components/RequireRole'
import { StatusChip } from '../../components/CaseBits'
import { useI18n } from '../../i18n'
import { callFn, errorKey } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useControlFeed } from '../../lib/useLiveCases'
import { shortId, type CaseRow } from '../../lib/useLiveCase'
import { useSafePoints } from '../../lib/useSafePoints'

const POLICE_TONE: Record<string, string> = {
  'Record only': 'bg-sand-deep text-ink',
  'In safe custody': 'bg-ink text-cream',
  'Active takeover': 'bg-danger text-white',
  'URGENT: verification failed': 'bg-danger text-white animate-pulse',
  Reunited: 'bg-reunited text-white',
}

export default function Police() {
  const { t } = useI18n()
  return (
    <>
      <div className="mb-6 flex items-center gap-3 rounded-xl bg-danger-soft p-4 font-semibold text-danger" role="note">
        <Siren className="size-6 shrink-0" aria-hidden />
        {t('police.simulated')}
      </div>
      <RequireRole roles={['police', 'admin']}>
        <Records />
        <SignedInAs />
      </RequireRole>
    </>
  )
}

function Records() {
  const { t, lang } = useI18n()
  const { cases, police, error } = useControlFeed()
  const { state } = useSafePoints()
  const [open, setOpen] = useState<string | null>(null)
  const spName = (id: string | null) => {
    const p = state.status === 'ready' ? state.points.find((x) => x.id === id) : undefined
    return p ? (lang === 'ur' && p.name_ur ? p.name_ur : p.name_en) : '—'
  }
  const urgent = cases?.filter((c) => ['Active takeover', 'URGENT: verification failed'].includes(police[c.id]?.status ?? '')).length ?? 0

  return (
    <>
      <PageHeader title={t('police.title')} lead={t('police.lead')} />
      <div className="mb-6"><NearbyAlerts mode="police" /></div>
      {urgent > 0 && <div className="mb-4"><Notice tone="danger">{t('police.urgentCount', { n: urgent })}</Notice></div>}
      {error && <div className="mb-4"><Notice tone="danger">{t('errors.network_error')}</Notice></div>}
      {!cases && <div className="h-40 animate-pulse rounded-2xl bg-sand" aria-label={t('common.loading')} />}
      {cases && cases.length === 0 && <p className="text-ink-soft">{t('police.none')}</p>}
      {cases && cases.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-sand-deep">
          <table className="w-full min-w-[720px] text-start">
            <thead className="bg-sand-deep/60 text-sm">
              <tr>
                <th className="p-3 text-start">{t('police.case')}</th>
                <th className="p-3 text-start">{t('police.recordStatus')}</th>
                <th className="p-3 text-start">{t('police.caseStatus')}</th>
                <th className="p-3 text-start">{t('police.custody')}</th>
                <th className="p-3 text-start">{t('police.station')}</th>
                <th className="p-3 text-start">{t('police.reported')}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-deep bg-sand">
              {cases.map((c) => {
                const pr = police[c.id]
                return (
                  <Fragment key={c.id}>
                    <tr>
                      <td className="p-3">
                        <span className="font-mono font-bold" dir="ltr">#{shortId(c.id)}</span>
                        <span className="block text-xs text-ink-soft">{t(`admin.kind_${c.kind}`)}</span>
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex rounded-full px-3 py-1 text-sm font-bold ${POLICE_TONE[pr?.status ?? ''] ?? 'bg-sand-deep'}`}>
                          {pr ? t(`police.statuses.${pr.status}`) : '…'}
                        </span>
                      </td>
                      <td className="p-3"><StatusChip status={c.status} /></td>
                      <td className="p-3">{c.kind !== 'found' ? '—' : c.status === 'awaiting_safe_point' ? `→ ${spName(c.safe_point_id)}` : spName(c.safe_point_id)}</td>
                      <td className="p-3 text-sm">{pr?.station ?? '—'}</td>
                      <td className="p-3 tabular-nums text-ink-soft">{new Date(c.created_at).toLocaleTimeString(lang === 'ur' ? 'ur-PK' : 'en-GB')}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => setOpen(open === c.id ? null : c.id)}
                          aria-expanded={open === c.id}
                          className="inline-flex min-h-10 items-center gap-1 rounded-full border border-sand-deep px-3 text-sm font-semibold"
                        >
                          {t('police.details')} <ChevronDown className={`size-4 transition-transform ${open === c.id ? 'rotate-180' : ''}`} aria-hidden />
                        </button>
                      </td>
                    </tr>
                    {open === c.id && (
                      <tr>
                        <td colSpan={7} className="bg-cream p-4"><CaseDetail c={c} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-sm text-ink-soft">{t('police.photoPolicy')}</p>
    </>
  )
}

/** Summary, custody timeline from the audit log (R12), and an audited photo reveal. */
function CaseDetail({ c }: { c: CaseRow }) {
  const { t, lang } = useI18n()
  const [timeline, setTimeline] = useState<Array<{ id: number; action: string; actor: string; created_at: string }>>([])
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const summary = lang === 'ur' ? c.ai_extract?.summary_ur : c.ai_extract?.summary_en

  useEffect(() => {
    void supabase.from('audit_log').select('id, action, actor, created_at').eq('case_id', c.id).order('id').then(({ data }) => setTimeline(data ?? []))
  }, [c.id, c.status])

  async function reveal() {
    setError(null)
    try {
      const r = await callFn<{ url: string | null }>('media-url', { case_id: c.id, reveal: true })
      setPhoto(r.url)
      if (!r.url) setError('police.noPhoto')
    } catch (e) {
      setError(errorKey(e))
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_260px]">
      <div className="space-y-3">
        <p className="font-semibold">
          {[c.child_name, c.father_name && t('match.childOf', { f: c.father_name }), c.gender && t(`finder.about.${c.gender}`), c.age_est != null && t('sp.age', { n: c.age_est })].filter(Boolean).join(' · ') || t('sp.detailsPending')}
        </p>
        {summary && <p>{summary}</p>}
        <ol className="space-y-1 border-s-2 border-sand-deep ps-4 text-sm" dir="ltr">
          {timeline.map((e) => (
            <li key={e.id} className="flex gap-3">
              <time className="w-20 shrink-0 tabular-nums text-ink-soft">{new Date(e.created_at).toLocaleTimeString('en-GB')}</time>
              <span className="font-mono">{e.action}</span>
              <span className="text-ink-soft">({e.actor})</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="space-y-2">
        {photo ? (
          <img src={photo} alt={t('sp.childPhoto')} className="aspect-[3/4] w-full rounded-xl object-cover" referrerPolicy="no-referrer" />
        ) : (
          <button type="button" onClick={() => void reveal()} className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sand-deep font-semibold text-ink-soft hover:bg-sand">
            <Eye className="size-8" aria-hidden />
            {t('police.reveal')}
          </button>
        )}
        <p className="text-xs text-ink-soft">{t('police.revealNote')}</p>
        {error && <Notice tone="danger">{t(error)}</Notice>}
      </div>
    </div>
  )
}
