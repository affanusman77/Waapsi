import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from './Button'
import { Notice } from './ui'
import { useI18n } from '../i18n'
import { callFn, errorKey } from '../lib/api'

type Result = { text: string | null; summary_en: string | null; summary_ur: string | null; ai_status: 'ok' | 'partial' | 'empty' | 'off' | 'failed' }

/**
 * "Summarise with AI" under a recorded voice note: transcribes it and shows a one-line summary in
 * English and Urdu, so the speaker can check the AI understood them before sending. A preview only:
 * the case pipeline summarises again after the report is filed.
 */
export function VoiceSummary({ voice, kind, getPath }: { voice: Blob | null; kind: 'found' | 'lost'; getPath: () => Promise<string | null> }) {
  const { t, lang } = useI18n()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A new recording makes the old summary wrong.
  useEffect(() => {
    setResult(null)
    setError(null)
  }, [voice])

  if (!voice) return null

  async function summarise() {
    setBusy(true)
    setError(null)
    try {
      const voice_path = await getPath()
      if (!voice_path) throw new Error('no voice note')
      setResult(await callFn<Result>('ai-transcribe', { voice_path, summarize: true, kind }))
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(false)
    }
  }

  const summary = lang === 'ur' ? result?.summary_ur ?? result?.summary_en : result?.summary_en
  return (
    <div className="space-y-3">
      {!result && (
        <Button variant="secondary" busy={busy} icon={<Sparkles className="size-5" aria-hidden />} onClick={() => void summarise()}>
          {t('voiceSummary.button')}
        </Button>
      )}
      {result && (
        <section className="space-y-2 rounded-2xl border-2 border-sand-deep bg-sand p-4" aria-live="polite">
          <h2 className="flex items-center gap-2 font-bold">
            <Sparkles className="size-5 text-terracotta" aria-hidden /> {t('voiceSummary.title')}
          </h2>
          {summary ? (
            <p className="text-lg">{summary}</p>
          ) : (
            <p className="text-ink-soft">{t(`voiceSummary.status_${result.ai_status}`)}</p>
          )}
          {result.text && (
            <details>
              <summary className="cursor-pointer font-semibold text-ink-soft">{t('voiceSummary.heard')}</summary>
              <p className="mt-1 text-ink-soft" dir="auto">{result.text}</p>
            </details>
          )}
          {summary && <p className="text-sm text-ink-soft">{t('voiceSummary.check')}</p>}
        </section>
      )}
      {error && <Notice tone="danger">{t(error)}</Notice>}
    </div>
  )
}
