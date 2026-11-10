import type { ReactNode } from 'react'
import { Construction } from 'lucide-react'
import { useI18n } from '../i18n'

export function PageHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-extrabold tracking-tight text-balance">{title}</h1>
      {lead && <p className="mt-2 text-lg text-ink-soft text-pretty">{lead}</p>}
    </div>
  )
}

/** Progress dots shown at the top of multi-step flows (one action per screen). */
export function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="mb-6 flex gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2 flex-1 rounded-full ${i < current ? 'bg-terracotta' : 'bg-sand-deep'}`}
        />
      ))}
    </div>
  )
}

export function PhaseStub({ phase, children }: { phase: number; children?: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="rounded-2xl border border-dashed border-sand-deep bg-sand/60 p-6">
      <p className="flex items-center gap-3 font-semibold">
        <Construction className="size-6 shrink-0 text-terracotta" aria-hidden />
        {t('common.comingInPhase', { n: phase })}
      </p>
      {children}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'danger'; children: ReactNode }) {
  const cls = tone === 'danger' ? 'bg-danger-soft text-danger border-danger/30' : 'bg-sand border-sand-deep'
  return <div className={`rounded-xl border p-4 font-medium ${cls}`}>{children}</div>
}
