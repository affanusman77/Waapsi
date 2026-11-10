import { CircleCheck, ShieldCheck } from 'lucide-react'
import { useI18n } from '../i18n'
import { brand } from '../config/brand'

export function formatReunion(seconds: number, t: (k: string, v?: Record<string, string | number>) => string) {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return m ? t('reunited.minSec', { m, s: s % 60 }) : t('reunited.sec', { s })
}

/** The demo climax (spec section 13): warm glow, a tick, the frozen timer, police chip turned green. */
export function ReunitedMoment({ fromIso, toIso, compact = false }: { fromIso: string; toIso: string; compact?: boolean }) {
  const { t } = useI18n()
  const secs = (Date.parse(toIso) - Date.parse(fromIso)) / 1000
  return (
    <section className={`reunited-glow relative overflow-hidden rounded-3xl bg-reunited-soft text-center ${compact ? 'p-5' : 'p-8'}`} role="status">
      <div className="relative mx-auto grid size-20 place-items-center rounded-full bg-reunited text-white shadow-lg">
        <CircleCheck className="size-12" aria-hidden />
      </div>
      <h2 className="relative mt-4 text-3xl font-extrabold text-reunited">{t('reunited.title')}</h2>
      <p className="relative mt-1 text-xl font-bold tabular-nums">{formatReunion(secs, t)}</p>
      <p className="relative mt-3 inline-flex items-center gap-2 rounded-full bg-reunited px-4 py-1.5 font-bold text-white">
        <ShieldCheck className="size-4" aria-hidden />
        {t('reunited.police')}
      </p>
      {!compact && <p className="relative mt-4 font-urdu text-xl">{brand.taglineUr}</p>}
    </section>
  )
}
