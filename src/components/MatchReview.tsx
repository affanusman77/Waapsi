import { useEffect, useState } from 'react'
import { ImageOff, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from './Button'
import { Notice } from './ui'
import { CasePhoto } from './CaseBits'
import { useI18n } from '../i18n'
import { callFn, errorKey } from '../lib/api'
import type { FinderMatch } from '../lib/useMatches'

function LostPhoto({ matchId, className }: { matchId: string; className: string }) {
  const { t } = useI18n()
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    callFn<{ url: string | null }>('media-url', { which: 'lost_photo', match_id: matchId })
      .then((r) => alive && setUrl(r.url))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [matchId])
  if (url === undefined) return <div className={`animate-pulse bg-sand-deep ${className}`} />
  if (!url)
    return (
      <div className={`grid place-items-center bg-sand-deep text-ink-soft ${className}`}>
        <ImageOff className="size-8" aria-hidden />
      </div>
    )
  return <img src={url} alt={t('match.parentPhoto')} className={`object-cover ${className}`} referrerPolicy="no-referrer" />
}

/**
 * The finder (or safe point staff for under-4s) compares the PARENT's photo with the child in
 * front of them (R2: photos flow toward the finder, never toward the parent) and decides (R3).
 */
export function MatchReview({ m, showChildPhoto = false, onDecided }: { m: FinderMatch; showChildPhoto?: boolean; onDecided?: () => void }) {
  const { t, lang } = useI18n()
  const [busy, setBusy] = useState<'confirm' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const strong = m.score >= 0.8

  async function decide(decision: 'confirm' | 'reject') {
    setBusy(decision)
    setError(null)
    try {
      await callFn('match-decision', { match_id: m.match_id, decision })
      onDecided?.()
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border-2 border-terracotta bg-sand p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-extrabold">{t('match.title')}</h2>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${strong ? 'bg-terracotta text-white' : 'bg-sand-deep'}`}>
          {strong ? t('match.strong') : t('match.possible')} · {Math.round(m.score * 100)}%
        </span>
        {m.lost_kind === 'checkin' && <span className="rounded-full bg-ink px-3 py-1 text-sm font-bold text-cream">{t('match.fromCheckin')}</span>}
      </div>

      <div className={`grid gap-3 ${showChildPhoto ? 'grid-cols-2' : ''}`}>
        <figure>
          <LostPhoto matchId={m.match_id} className="aspect-[3/4] w-full rounded-xl" />
          <figcaption className="mt-1 text-sm font-semibold text-ink-soft">{t('match.parentPhoto')}</figcaption>
        </figure>
        {showChildPhoto && (
          <figure>
            <CasePhoto caseId={m.found_case_id} className="aspect-[3/4] w-full rounded-xl" />
            <figcaption className="mt-1 text-sm font-semibold text-ink-soft">{t('match.childHere')}</figcaption>
          </figure>
        )}
      </div>

      <p className="font-semibold">
        {[m.lost_child_name, m.lost_father_name && t('match.childOf', { f: m.lost_father_name }), m.lost_age_est != null && t('sp.age', { n: m.lost_age_est })]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <ul className="space-y-1">
        {m.reasons.map((r) => (
          <li key={r.factor} className="flex items-center gap-2">
            <span className={`size-2.5 shrink-0 rounded-full ${r.score >= 0.75 ? 'bg-terracotta' : r.score >= 0.4 ? 'bg-ink-soft' : 'bg-sand-deep'}`} aria-hidden />
            <span>{lang === 'ur' ? r.text_ur : r.text_en}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-soft">{t('match.aiSuggests')}</p>

      {m.match_status === 'suggested' && (
        <div className="grid gap-3">
          <Button busy={busy === 'confirm'} disabled={!!busy} icon={<ThumbsUp className="size-6" aria-hidden />} onClick={() => void decide('confirm')}>
            {t('match.yes')}
          </Button>
          <Button variant="secondary" busy={busy === 'reject'} disabled={!!busy} icon={<ThumbsDown className="size-6" aria-hidden />} onClick={() => void decide('reject')}>
            {t('match.no')}
          </Button>
        </div>
      )}
      {error && <Notice tone="danger">{t(error)}</Notice>}
    </section>
  )
}
