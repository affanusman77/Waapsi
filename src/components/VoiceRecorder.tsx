import { useEffect, useRef, useState } from 'react'
import { Mic, RotateCcw, Square } from 'lucide-react'
import { useI18n } from '../i18n'

const MAX_SECONDS = 60
const TAP_THRESHOLD_MS = 350
const MIN_MS = 1500 // shorter than this can't hold a name and a description
// Loudness check: RMS of the mic signal, sampled every 100 ms. Room hiss sits around 0.002-0.01,
// speech near the phone around 0.03-0.3. We need ~0.4 s of sound above the line to accept it.
const SPEECH_RMS = 0.015
const MIN_LOUD_SAMPLES = 4

type Meter = { ctx: AudioContext; timer: number; loud: number }

function startMeter(stream: MediaStream): Meter | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const meter: Meter = { ctx, timer: 0, loud: 0 }
    meter.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const x of buf) sum += x * x
      if (Math.sqrt(sum / buf.length) > SPEECH_RMS) meter.loud++
    }, 100)
    return meter
  } catch {
    return null // no meter: the server still checks for silence
  }
}

function pickMime(): string | undefined {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m))
}

/**
 * Big mic button. Hold to record (release to stop), OR tap once to start and tap again to stop:
 * holding is hard for some people, and both gestures should just work.
 */
export function VoiceRecorder({ value, onChange }: { value: Blob | null; onChange: (b: Blob | null) => void }) {
  const { t } = useI18n()
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const pressStart = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const url = useUrl(value)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stop()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError(null)
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('voice.unsupported')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMime()
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      const chunks: Blob[] = []
      const meter = startMeter(stream)
      const startedAt = Date.now()
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop())
        if (meter) {
          window.clearInterval(meter.timer)
          void meter.ctx.close().catch(() => {})
        }
        if (!mounted.current) return
        const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] })
        // Never hand on a recording with nothing in it: Whisper would invent words for it.
        if (Date.now() - startedAt < MIN_MS) return setError('voice.tooShort')
        if (meter && meter.loud < MIN_LOUD_SAMPLES) return setError('voice.silent')
        if (blob.size > 0) onChange(blob)
      }
      rec.start()
      recRef.current = rec
      setRecording(true)
      setSeconds(0)
      timer.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop()
          return s + 1
        })
      }, 1000)
    } catch {
      setError('voice.denied')
    }
  }

  function stop() {
    window.clearInterval(timer.current)
    if (recRef.current?.state === 'recording') recRef.current.stop()
    recRef.current = null
    setRecording(false)
  }

  // Press while idle starts. Releasing after a long press stops (hold-to-record).
  // A quick tap leaves it recording; the next press stops it (tap-to-toggle).
  function onPointerDown() {
    if (recording) return stop()
    pressStart.current = Date.now()
    void start()
  }
  function onPointerUp() {
    if (recording && Date.now() - pressStart.current > TAP_THRESHOLD_MS) stop()
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {!value || recording ? (
        <>
          <button
            type="button"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (recording) stop()
                else void start()
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
            aria-pressed={recording}
            aria-label={recording ? t('voice.stop') : t('voice.record')}
            className={`grid size-40 select-none place-items-center rounded-full text-white shadow-lg transition-transform touch-none ${
              recording ? 'scale-110 bg-danger animate-pulse' : 'bg-terracotta hover:bg-terracotta-deep'
            }`}
          >
            {recording ? <Square className="size-14" aria-hidden /> : <Mic className="size-16" aria-hidden />}
          </button>
          <p className="text-center text-lg font-semibold" aria-live="polite">
            {recording ? t('voice.recording', { s: seconds }) : t('voice.holdOrTap')}
          </p>
        </>
      ) : (
        <div className="w-full space-y-3">
          <audio controls src={url ?? undefined} className="w-full" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex min-h-11 items-center gap-2 font-semibold underline-offset-4 hover:underline"
          >
            <RotateCcw className="size-5" aria-hidden />
            {t('voice.redo')}
          </button>
        </div>
      )}
      {error && <p className="font-semibold text-danger">{t(error)}</p>}
    </div>
  )
}

function useUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return setUrl(null)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
