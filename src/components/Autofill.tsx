import { useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Notice } from './ui'
import { useI18n } from '../i18n'
import { callFn } from '../lib/api'

/** What the AI pulled out of the voice note / typed text (all optional). */
export type AutoFields = {
  child_name: string | null
  father_name: string | null
  age_est: number | null
  gender: 'male' | 'female' | null
  top_color: string | null
  top_type: string | null
  bottom_color: string | null
  bottom_type: string | null
  home_area: string | null
}
export type AutofillStatus = 'ok' | 'partial' | 'unclear' | 'no_speech' | 'empty' | 'off' | 'failed'
export type AutofillResult = {
  ai_status: AutofillStatus
  text: string | null
  summary_en: string | null
  summary_ur: string | null
  fields: AutoFields
  reason: string | null
}

export const EMPTY_FIELDS: AutoFields = {
  child_name: null,
  father_name: null,
  age_est: null,
  gender: null,
  top_color: null,
  top_type: null,
  bottom_color: null,
  bottom_type: null,
  home_area: null,
}

/** Transcribe + extract on the server. Never creates a case. */
export async function requestAutofill(args: { voicePath: string | null; text: string; kind: 'found' | 'lost' }): Promise<AutofillResult> {
  const r = await callFn<Partial<AutofillResult>>('ai-transcribe', { voice_path: args.voicePath, text: args.text, kind: args.kind })
  // Defensive: an older server (or a partial reply) still gives a usable, empty form.
  return {
    ai_status: r.ai_status ?? 'failed',
    text: r.text ?? null,
    summary_en: r.summary_en ?? null,
    summary_ur: r.summary_ur ?? null,
    fields: { ...EMPTY_FIELDS, ...(r.fields ?? {}) },
    reason: r.reason ?? null,
  }
}

/** Names: letters in any script, spaces, dots, apostrophes and hyphens. Empty is allowed (optional fields). */
export function nameError(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  if (/[^\p{L}\p{M}\s.'-]/u.test(s)) return 'autofill.badName'
  if ((s.match(/\p{L}/gu) ?? []).length < 2) return 'autofill.shortName'
  return null
}

/**
 * Tracks which fields the AI filled and which the person changed. The AI may fill a field again
 * (after a new recording) only if the person hasn't touched it.
 */
export function useAutofillTracking() {
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set())
  return {
    touched,
    aiFilled,
    /** Mark a field as edited by the person: it loses its AI badge and is never overwritten. */
    touch(field: string) {
      setTouched((s) => (s.has(field) ? s : new Set(s).add(field)))
      setAiFilled((s) => {
        if (!s.has(field)) return s
        const n = new Set(s)
        n.delete(field)
        return n
      })
    },
    /** Apply AI values through `set`, skipping touched fields. Returns the fields filled. */
    apply<K extends string>(values: Record<K, unknown>, set: (field: K, value: unknown) => void, locked: Set<string> = new Set()) {
      const filled = new Set<string>()
      for (const k of Object.keys(values) as K[]) {
        if (touched.has(k) || locked.has(k)) continue
        const v = values[k]
        if (v !== null && v !== undefined && v !== '') {
          set(k, v)
          filled.add(k)
        } else if (aiFilled.has(k)) {
          set(k, null) // an earlier AI guess the new recording no longer supports
        }
      }
      setAiFilled(filled)
      return filled
    },
    reset() {
      setTouched(new Set())
      setAiFilled(new Set())
    },
  }
}

export function AiBadge({ show, photo }: { show: boolean; photo?: boolean }) {
  const { t } = useI18n()
  if (!show) return null
  return (
    <span className="ms-2 inline-flex items-center gap-1 rounded-full bg-sand-deep px-2 py-0.5 align-middle text-xs font-bold text-ink">
      <Sparkles className="size-3.5 text-terracotta" aria-hidden />
      {photo ? t('autofill.badgePhoto') : t('autofill.badge')}
    </span>
  )
}

export function TextField({
  label,
  value,
  onChange,
  numeric,
  ai,
  error,
  required,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** Digits only; `true` = up to 2 digits (an age), a number = that many digits (a year). */
  numeric?: boolean | number
  ai?: boolean
  error?: string | null
  required?: boolean
  hint?: string
}) {
  const { t } = useI18n()
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-bold">
        {label}
        {required && <span className="text-danger" aria-hidden> *</span>}
        <AiBadge show={!!ai} />
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/\D/g, '').slice(0, numeric === true ? 2 : numeric) : e.target.value.slice(0, 60))}
        inputMode={numeric ? 'numeric' : 'text'}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        aria-required={required}
        className={`h-14 w-full rounded-2xl border-2 bg-white px-4 text-lg outline-none focus:border-terracotta ${error ? 'border-danger' : 'border-sand-deep'}`}
      />
      {hint && !error && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
      {error && (
        <p id={`${id}-err`} className="mt-1 font-semibold text-danger">
          {t(error)}
        </p>
      )}
    </div>
  )
}

/** Required-choice group (boy/girl, age band) with an AI badge and an inline error. */
export function ChoiceGroup({ legend, ai, error, children }: { legend: string; ai?: boolean | 'photo'; error?: string | null; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <fieldset aria-invalid={!!error}>
      <legend className="mb-3 text-lg font-bold">
        {legend}
        <span className="text-danger" aria-hidden> *</span>
        <AiBadge show={!!ai} photo={ai === 'photo'} />
      </legend>
      {children}
      {error && <p className="mt-2 font-semibold text-danger">{t(error)}</p>}
    </fieldset>
  )
}

/** The AI's one-line summary (or why there isn't one) at the top of the review screen. */
export function AutofillSummary({ result }: { result: AutofillResult | null }) {
  const { t, lang } = useI18n()
  if (!result) return <Notice>{t('autofill.manualLead')}</Notice>
  const summary = lang === 'ur' ? (result.summary_ur ?? result.summary_en) : result.summary_en
  if (!summary) {
    const key = { ok: 'partial', partial: 'partial', unclear: 'unclear', empty: 'manualLead', off: 'off', failed: 'failed', no_speech: 'unclear' }[result.ai_status]
    return <Notice>{t(`autofill.${key}`)}</Notice>
  }
  return (
    <section className="space-y-2 rounded-2xl border-2 border-sand-deep bg-sand p-4" aria-live="polite">
      <h2 className="flex items-center gap-2 font-bold">
        <Sparkles className="size-5 text-terracotta" aria-hidden /> {t('autofill.summaryTitle')}
      </h2>
      <p className="text-lg" dir="auto">{summary}</p>
      {result.text && (
        <details>
          <summary className="cursor-pointer font-semibold text-ink-soft">{t('autofill.heard')}</summary>
          <p className="mt-1 text-ink-soft" dir="auto">{result.text}</p>
        </details>
      )}
      {result.ai_status === 'partial' && <p className="text-sm text-ink-soft">{t('autofill.partial')}</p>}
    </section>
  )
}

/** Full-width "AI is filling in the form" state shown while the request runs. */
export function AutofillWorking() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-sand-deep bg-sand p-5" role="status" aria-live="polite">
      <Sparkles className="size-7 shrink-0 animate-pulse text-terracotta" aria-hidden />
      <p className="text-lg font-semibold">{t('autofill.working')}</p>
    </div>
  )
}
