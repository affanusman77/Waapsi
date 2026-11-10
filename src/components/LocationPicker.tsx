import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { LocateFixed } from 'lucide-react'
import { colors } from '../config/brand'
import { DEMO_CENTER, type LatLng } from '../lib/geo'
import { useI18n } from '../i18n'

export type PickedLocation = LatLng & { approx: boolean }

const childIcon = L.divIcon({
  className: '',
  iconSize: [44, 52],
  iconAnchor: [22, 50],
  html: `<svg width="44" height="52" viewBox="0 0 44 52" aria-hidden="true">
    <path d="M22 51s19-17 19-31A19 19 0 0 0 3 20c0 14 19 31 19 31z" fill="${colors.terracotta}" stroke="${colors.cream}" stroke-width="3"/>
    <circle cx="22" cy="20" r="7" fill="${colors.cream}"/></svg>`,
})

function Recenter({ at }: { at: LatLng }) {
  const map = useMap()
  useEffect(() => {
    map.setView([at.lat, at.lng], Math.max(map.getZoom(), 17))
  }, [at.lat, at.lng, map])
  return null
}

/** Auto GPS + a pin you can drag to correct it. If GPS is refused, starts at the event centre (flagged approx). */
export function LocationPicker({ value, onChange }: { value: PickedLocation | null; onChange: (l: PickedLocation) => void }) {
  const { t } = useI18n()
  const [status, setStatus] = useState<'locating' | 'ok' | 'denied'>('locating')
  const [center, setCenter] = useState<LatLng>(value ?? DEMO_CENTER)

  function locate() {
    if (!navigator.geolocation) {
      setStatus('denied')
      if (!value) onChange({ ...DEMO_CENTER, approx: true })
      return
    }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setStatus('ok')
        setCenter(at)
        onChange({ ...at, approx: pos.coords.accuracy > 150 })
      },
      () => {
        setStatus('denied')
        if (!value) onChange({ ...DEMO_CENTER, approx: true })
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  useEffect(() => {
    if (!value) locate()
    else setStatus('ok')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handlers = useMemo(
    () => ({
      dragend(e: L.LeafletEvent) {
        const p = (e.target as L.Marker).getLatLng()
        onChange({ lat: p.lat, lng: p.lng, approx: false })
      },
    }),
    [onChange],
  )

  return (
    <div className="space-y-3">
      <p className="font-semibold" aria-live="polite">
        {status === 'locating' ? t('location.locating') : status === 'denied' ? t('location.denied') : t('location.dragHint')}
      </p>
      <MapContainer center={[center.lat, center.lng]} zoom={17} className="h-[50vh] min-h-72 w-full rounded-2xl border border-sand-deep">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Recenter at={center} />
        {value && <Marker position={[value.lat, value.lng]} draggable icon={childIcon} eventHandlers={handlers} />}
      </MapContainer>
      <button
        type="button"
        onClick={locate}
        className="inline-flex min-h-11 items-center gap-2 font-semibold underline-offset-4 hover:underline"
      >
        <LocateFixed className="size-5" aria-hidden />
        {t('location.useGps')}
      </button>
    </div>
  )
}
