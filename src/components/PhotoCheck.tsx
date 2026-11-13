import { useCallback, useRef, useState } from 'react'
import { CircleCheck, Loader2, ScanFace, TriangleAlert } from 'lucide-react'
import { useI18n } from '../i18n'
import { callFn } from '../lib/api'

export type PhotoEstimate = { age_low: number | null; age_high: number | null; age_est: number | null; gender: 'male' | 'female' | null; adult: boolean }
export type PhotoCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; estimate: PhotoEstimate }
  | { status: 'retake'; why: string }
  | { status: 'off' }
  | { status: 'error' }

/** True when the person may continue with this photo (a failed/unavailable check never blocks a report). */
export const photoUsable = (s: PhotoCheckState) => s.status === 'ok' || s.status === 'off' || s.status === 'error'

/**
 * Checks each new photo with photo-check (one clear face?). Only the latest photo's result counts,
 * so a slow check for an old photo can't overwrite a newer one.
 */
export function usePhotoCheck(bucket: 'case-photos' | 'child-profiles' = 'case-photos') {
  const [state, setState] = useState<PhotoCheckState>({ status: 'idle' })
  const seq = useRef(0)
  const check = useCallback(
    async (path: Promise<string | null> | string | null) => {
      const mine = ++seq.current
      setState({ status: 'checking' })
      try {
        const p = await path
        if (!p) throw new Error('no path')
        const r = await callFn<PhotoCheckState>('photo-check', { photo_path: p, bucket })
        if (mine === seq.current) setState(r && 'status' in r ? r : { status: 'error' })
      } catch {
        if (mine === seq.current) setState({ status: 'error' })
      }
    },
    [bucket],
  )
  const reset = useCallback(() => {
    seq.current++
    setState({ status: 'idle' })
  }, [])
  return { state, check, reset }
}

/** One line under the photo: checking… / clear photo (+ what it suggests) / retake and why. */
export function PhotoCheckNotice({ state, showEstimate = true }: { state: PhotoCheckState; showEstimate?: boolean }) {
  const { t } = useI18n()
  if (state.status === 'idle' || state.status === 'off') return null
  if (state.status === 'checking') {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-sand p-3 font-semibold" role="status" aria-live="polite">
        <Loader2 className="size-5 animate-spin" aria-hidden /> {t('photoCheck.checking')}
      </p>
    )
  }
  if (state.status === 'error') return <p className="rounded-xl bg-sand p-3 text-sm text-ink-soft">{t('photoCheck.unavailable')}</p>
  if (state.status === 'retake') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft p-3 font-semibold text-danger" role="alert">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{t(`photoCheck.why_${state.why}`)} {t('photoCheck.retake')}</span>
      </div>
    )
  }
  const e = state.estimate
  const parts = [
    e.gender ? t(`finder.about.${e.gender}`) : null,
    e.age_low !== null && e.age_high !== null ? t('photoCheck.ageRange', { a: e.age_low, b: e.age_high }) : null,
  ].filter(Boolean)
  return (
    <div className="space-y-1 rounded-xl bg-sand p-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 font-semibold">
        <CircleCheck className="size-5 text-reunited" aria-hidden /> {t('photoCheck.ok')}
      </p>
      {showEstimate && parts.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <ScanFace className="size-4" aria-hidden /> {t('photoCheck.suggests', { what: parts.join(' · ') })}
        </p>
      )}
      {e.adult && <p className="text-sm font-semibold text-danger">{t('photoCheck.adult')}</p>}
    </div>
  )
}
