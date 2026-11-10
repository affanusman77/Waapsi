import { useEffect, useState } from 'react'
import { Check, MessageCircleQuestion, Pencil, Sparkles, X } from 'lucide-react'
import { Button } from './Button'
import { VoiceRecorder } from './VoiceRecorder'
import { Notice } from './ui'
import { useI18n } from '../i18n'
import { callFn, errorKey } from '../lib/api'
import { uploadMedia } from '../lib/media'
import type { CaseRow } from '../lib/useLiveCase'

export const COLOURS = ['red', 'blue', 'green', 'yellow', 'white', 'black', 'pink', 'orange', 'purple', 'brown', 'grey'] as const
const SWATCH: Record<string, string> = {
  red: '#C62828', blue: '#1565C0', green: '#2E7D32', yellow: '#F9A825', white: '#FFFFFF', black: '#1B1B1B',
  pink: '#EC6FA6', orange: '#EF6C00', purple: '#6A1B9A', brown: '#6D4C41', grey: '#8D8D8D',
}

export function ColourSwatch({ c }: { c: string }) {
  return <span className="inline-block size-4 shrink-0 rounded-full border border-ink/20 align-middle" style={{ background: SWATCH[c] }} aria-hidden />
}

/** Big colour chips (no typing): used by finders, parents and gate check-in. */
export function ColourPicker({ value, onChange, label }: { value: string | null; onChange: (c: string | null) => void; label: string }) {
  const { t } = useI18n()
  return (
    <fieldset>
      <legend className="mb-2 font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {COLOURS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={value === c}
            onClick={() => onChange(value === c ? null : c)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-3 font-semibold ${value === c ? 'border-ink bg-ink text-cream' : 'border-sand-deep bg-white'}`}
          >
            <ColourSwatch c={c} />
            {t(`colours.${c}`)}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

type Q = { field: string; ur: string; roman: string; en: string }

/** Case card (screen 5): AI summary, editable chips, and one guided question at a time. */
export function CaseCard({ c, guided = true }: { c: CaseRow; guided?: boolean }) {
  const { t, lang } = useI18n()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pending = c.ai_status === 'pending'
  const summary = lang === 'ur' ? c.ai_extract?.summary_ur : c.ai_extract?.summary_en

  async function save(field: string, value: unknown) {
    setError(null)
    try {
      await callFn('case-update', { case_id: c.id, fields: { [field]: value } })
      setEditing(null)
    } catch (e) {
      setError(errorKey(e))
    }
  }

  const chips: Array<{ key: string; label: string; value: string | null; input?: 'text' | 'number' }> = [
    { key: 'child_name', label: t('card.name'), value: c.child_name, input: 'text' },
    { key: 'father_name', label: t('card.father'), value: c.father_name, input: 'text' },
    { key: 'age_est', label: t('card.age'), value: c.age_est != null ? String(c.age_est) : null, input: 'number' },
    { key: 'gender', label: t('card.gender'), value: c.gender ? t(`finder.about.${c.gender}`) : null },
  ]

  return (
    <section className="space-y-4 rounded-2xl border-2 border-sand-deep bg-sand p-4">
      <header className="flex items-center gap-2">
        <Sparkles className="size-5 text-terracotta" aria-hidden />
        <h2 className="text-lg font-extrabold">{t('card.title')}</h2>
        <span className="ms-auto text-xs font-semibold text-ink-soft">
          {pending ? t('card.listening') : c.ai_extract?.source === 'ai' ? t('card.byAi') : t('card.byKeywords')}
        </span>
      </header>
      {pending && <div className="h-6 w-2/3 animate-pulse rounded bg-sand-deep" aria-label={t('card.listening')} />}
      {summary && <p className="text-lg">{summary}</p>}

      <ul className="flex flex-wrap gap-2">
        {chips.map((ch) => (
          <li key={ch.key}>
            {editing === ch.key && ch.input ? (
              <form
                className="flex items-center gap-1 rounded-full border-2 border-terracotta bg-white ps-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void save(ch.key, ch.input === 'number' ? (draft === '' ? null : Number(draft)) : draft)
                }}
              >
                <input
                  autoFocus
                  value={draft}
                  type={ch.input === 'number' ? 'number' : 'text'}
                  inputMode={ch.input === 'number' ? 'numeric' : 'text'}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label={ch.label}
                  className="h-10 w-28 bg-transparent outline-none"
                />
                <button type="submit" className="grid size-10 place-items-center" aria-label={t('card.save')}>
                  <Check className="size-5" aria-hidden />
                </button>
                <button type="button" onClick={() => setEditing(null)} className="grid size-10 place-items-center" aria-label={t('card.cancel')}>
                  <X className="size-5" aria-hidden />
                </button>
              </form>
            ) : ch.key === 'gender' ? (
              <span className="inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-sand-deep bg-white ps-3 pe-1">
                <span className="text-ink-soft">{ch.label}:</span>
                {(['male', 'female'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={c.gender === g}
                    onClick={() => void save('gender', c.gender === g ? null : g)}
                    className={`min-h-9 rounded-full px-3 font-semibold ${c.gender === g ? 'bg-ink text-cream' : ''}`}
                  >
                    {t(`finder.about.${g}`)}
                  </button>
                ))}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft(ch.key === 'age_est' ? (c.age_est?.toString() ?? '') : (ch.value ?? ''))
                  setEditing(ch.key)
                }}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-3 ${ch.value ? 'border-ink bg-white' : 'border-dashed border-sand-deep'}`}
              >
                <span className="text-ink-soft">{ch.label}:</span>
                <span className="font-bold">{ch.value ?? '—'}</span>
                <Pencil className="size-4 text-ink-soft" aria-hidden />
              </button>
            )}
          </li>
        ))}
        {(c.clothing?.top_color || c.clothing?.bottom_color) && (
          <li className="inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-ink bg-white px-3">
            <span className="text-ink-soft">{t('card.clothes')}:</span>
            {c.clothing?.top_color && (
              <span className="inline-flex items-center gap-1 font-bold">
                <ColourSwatch c={c.clothing.top_color} /> {t(`colours.${c.clothing.top_color}`)} {c.clothing.top_type ?? ''}
              </span>
            )}
            {c.clothing?.bottom_color && (
              <span className="inline-flex items-center gap-1 font-bold">
                <ColourSwatch c={c.clothing.bottom_color} /> {t(`colours.${c.clothing.bottom_color}`)} {c.clothing.bottom_type ?? ''}
              </span>
            )}
          </li>
        )}
      </ul>
      {error && <Notice tone="danger">{t(error)}</Notice>}
      {guided && !pending && <GuidedQuestion caseId={c.id} />}
    </section>
  )
}

function GuidedQuestion({ caseId }: { caseId: string }) {
  const { t, lang } = useI18n()
  const [q, setQ] = useState<Q | null>(null)
  const [asked, setAsked] = useState<string[]>([])
  const [voice, setVoice] = useState<Blob | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    callFn<{ question: Q }>('ai-next-question', { case_id: caseId, already_asked: asked })
      .then((r) => alive && setQ(r.question))
      .catch(() => alive && setQ(null))
    return () => {
      alive = false
    }
  }, [caseId, asked])

  if (!q || q.field === 'done') return null

  async function submit() {
    setBusy(true)
    try {
      const answer_voice_path = voice ? await uploadMedia('voice-notes', voice) : undefined
      await callFn('ai-extract', { case_id: caseId, answer_text: text || undefined, answer_voice_path })
    } catch {
      /* fail open: the case is already saved; the chips just don't change */
    } finally {
      setVoice(null)
      setText('')
      setBusy(false)
      setAsked((a) => [...a, q!.field])
    }
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-terracotta/40 bg-white p-4">
      <p className="flex items-center gap-2 font-bold text-terracotta">
        <MessageCircleQuestion className="size-5" aria-hidden />
        {t('card.askChild')}
      </p>
      <p className="font-urdu text-2xl" dir="rtl" lang="ur">{q.ur}</p>
      <p className="text-lg font-semibold">{lang === 'ur' ? q.en : q.roman}</p>
      <VoiceRecorder value={voice} onChange={setVoice} />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('card.typeAnswer')}
        className="min-h-12 w-full rounded-xl border-2 border-sand-deep px-3 outline-none focus:border-terracotta"
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setAsked((a) => [...a, q.field])}>{t('card.skipQ')}</Button>
        <Button busy={busy} disabled={!voice && !text.trim()} onClick={() => void submit()}>{t('card.useAnswer')}</Button>
      </div>
    </div>
  )
}
