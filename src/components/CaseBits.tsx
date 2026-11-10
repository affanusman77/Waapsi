import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { useI18n } from '../i18n'
import { callFn } from '../lib/api'

/** Re-renders every `ms` so countdowns and "waiting for" timers tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

const STATUS_TONE: Record<string, string> = {
  reported: 'bg-sand-deep text-ink',
  awaiting_safe_point: 'bg-sand-deep text-ink',
  at_safe_point: 'bg-ink text-cream',
  matched: 'bg-terracotta text-white',
  finder_confirmed: 'bg-terracotta text-white',
  verifying: 'bg-terracotta text-white',
  reunited: 'bg-reunited text-white',
  escalated_police: 'bg-danger text-white',
  handover_blocked: 'bg-danger text-white',
  closed_no_match: 'bg-sand-deep text-ink',
  expired: 'bg-sand-deep text-ink-soft',
}

export function StatusChip({ status }: { status: string }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${STATUS_TONE[status] ?? 'bg-sand-deep'}`}>
      {t(`status.${status}`)}
    </span>
  )
}

/** Escalation countdown (R5). Turns red once police have taken over or time is up. */
export function EscalationCountdown({ escalateAt, status }: { escalateAt: string | null; status: string }) {
  const { t } = useI18n()
  const now = useNow()
  if (status === 'escalated_police') return <span className="font-bold text-danger">{t('sp.policeTookOver')}</span>
  if (!escalateAt || ['reunited', 'handover_blocked', 'closed_no_match', 'expired'].includes(status)) return null
  const left = (new Date(escalateAt).getTime() - now) / 1000
  return (
    <span className={`font-semibold tabular-nums ${left <= 0 ? 'text-danger' : 'text-ink-soft'}`}>
      {left > 0 ? t('sp.policeIn', { t: formatDuration(left) }) : t('sp.policeDue')}
    </span>
  )
}

/** Fetches a 2-minute signed URL after a server-side role check; nothing is cached on the device. */
export function CasePhoto({ caseId, className = '' }: { caseId: string; className?: string }) {
  const { t } = useI18n()
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    callFn<{ url: string | null }>('media-url', { case_id: caseId })
      .then((r) => alive && setUrl(r.url))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [caseId])
  if (url === undefined) return <div className={`animate-pulse bg-sand-deep ${className}`} />
  if (!url)
    return (
      <div className={`grid place-items-center bg-sand-deep text-ink-soft ${className}`} aria-label={t('sp.noPhoto')}>
        <ImageOff className="size-8" aria-hidden />
      </div>
    )
  return <img src={url} alt={t('sp.childPhoto')} className={`object-cover ${className}`} referrerPolicy="no-referrer" />
}
