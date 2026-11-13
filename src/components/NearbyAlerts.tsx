import { useCallback, useEffect, useState } from 'react'
import { MapPin, Radar } from 'lucide-react'
import { ColourSwatch } from './CaseCard'
import { Notice } from './ui'
import { useI18n } from '../i18n'
import { callFn } from '../lib/api'
import { supabase } from '../lib/supabase'

type Alert = {
  case_id: string
  short_id: string
  gender: 'male' | 'female' | null
  age_est: number | null
  top_color: string | null
  top_type: string | null
  bottom_color: string | null
  bottom_type: string | null
  under_4: boolean
  near_en: string | null
  near_ur: string | null
  distance_m: number | null
  minutes_ago: number
  status: string
  responders: number
}

/**
 * Geofenced missing-child alerts for verified responders (safe point staff, police). No name, no
 * photo, no exact location: only what helps recognise a child who is brought in.
 */
export function NearbyAlerts({ mode }: { mode: 'sp' | 'police' }) {
  const { t, lang } = useI18n()
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [radius, setRadius] = useState(20)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await callFn<{ radius_km: number; alerts: Alert[] }>('nearby-alerts', {})
      setAlerts(r.alerts ?? [])
      setRadius(r.radius_km ?? 20)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel(`nearby-alerts-${mode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, () => void load())
      .subscribe()
    const timer = window.setInterval(() => void load(), 60_000) // keeps "minutes ago" fresh
    return () => {
      window.clearInterval(timer)
      void supabase.removeChannel(ch)
    }
  }, [load, mode])

  // Never block the desk: if the alerts service can't be reached at all, leave the panel out.
  if (failed && alerts === null) return null

  const who = (a: Alert) => (a.gender === 'female' ? t('finder.about.female') : a.gender === 'male' ? t('finder.about.male') : t('geofence.child'))
  const ago = (m: number) => (m < 60 ? t('geofence.minAgo', { n: m }) : t('geofence.hAgo', { n: Math.floor(m / 60) }))

  return (
    <section className="rounded-2xl border-2 border-danger/30 bg-danger-soft/40 p-4" aria-live="polite">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Radar className="size-6 text-danger" aria-hidden />
        {t('geofence.title', { km: radius, n: alerts?.length ?? 0 })}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">{mode === 'sp' ? t('geofence.leadSp') : t('geofence.leadPolice', { km: radius })}</p>
      {failed && <div className="mt-3"><Notice tone="danger">{t('errors.network_error')}</Notice></div>}
      {/* failed after a successful load: keep the last list and show the notice */}
      {alerts === null && !failed && <div className="mt-3 h-16 animate-pulse rounded-xl bg-sand" />}
      {alerts && alerts.length === 0 && <p className="mt-3 text-ink-soft">{t('geofence.none', { km: radius })}</p>}
      {alerts && alerts.length > 0 && (
        <ul className="mt-3 space-y-2">
          {alerts.map((a) => (
            <li key={a.case_id} className="rounded-xl border border-sand-deep bg-white p-3">
              <p className="flex flex-wrap items-center gap-x-2 font-bold">
                <span className="rounded-full bg-danger px-2 py-0.5 text-xs text-white">{t('geofence.missing')}</span>
                {who(a)}
                {a.age_est !== null && <span>· {t('sp.age', { n: a.age_est })}</span>}
                {a.under_4 && <span className="text-danger">· {t('geofence.under4')}</span>}
                <span className="ms-auto font-mono text-xs text-ink-soft" dir="ltr">#{a.short_id}</span>
              </p>
              {(a.top_color || a.bottom_color) && (
                <p className="mt-1 flex flex-wrap items-center gap-3 text-ink-soft">
                  {a.top_color && <span className="inline-flex items-center gap-1"><ColourSwatch c={a.top_color} /> {t(`colours.${a.top_color}`)} {a.top_type ?? ''}</span>}
                  {a.bottom_color && <span className="inline-flex items-center gap-1"><ColourSwatch c={a.bottom_color} /> {t(`colours.${a.bottom_color}`)} {a.bottom_type ?? ''}</span>}
                </p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                {a.near_en && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-4" aria-hidden />
                    {t('geofence.near', { place: lang === 'ur' && a.near_ur ? a.near_ur : a.near_en })}
                  </span>
                )}
                {a.distance_m !== null && <span>{t('geofence.away', { km: (a.distance_m / 1000).toFixed(1) })}</span>}
                <span>{ago(a.minutes_ago)}</span>
                {mode === 'police' && <span>{t('geofence.responders', { n: a.responders })}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
