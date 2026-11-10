import { useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw } from 'lucide-react'
import { Button } from './Button'
import { useI18n } from '../i18n'

/** Opens the rear camera directly (capture="environment"); shows a preview with "retake". */
export function PhotoCapture({
  value,
  onChange,
  label,
  variant = 'primary',
}: {
  value: Blob | null
  onChange: (f: File | null) => void
  label: string
  variant?: 'primary' | 'secondary'
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!value) return setUrl(null)
    const u = URL.createObjectURL(value)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [value])

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
      {url ? (
        <div className="space-y-3">
          <img src={url} alt="" className="aspect-[3/4] w-full rounded-2xl border border-sand-deep object-cover" />
          <Button variant="secondary" icon={<RotateCcw className="size-5" aria-hidden />} onClick={() => input.current?.click()}>
            {t('photo.retake')}
          </Button>
        </div>
      ) : (
        <Button variant={variant} icon={<Camera className="size-6" aria-hidden />} onClick={() => input.current?.click()}>
          {label}
        </Button>
      )}
    </div>
  )
}
