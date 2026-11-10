import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip } from 'react-leaflet'
import { colors } from '../config/brand'
import { DEMO_CENTER } from '../lib/geo'
import type { SafePoint } from '../lib/supabase'
import { useI18n } from '../i18n'

function pinIcon(womenStaff: boolean) {
  // Teal is reserved for "Reunited" and red for escalation, so Behan Desk uses deep ink.
  const fill = womenStaff ? colors.ink : colors.terracotta
  // Behan Desk pins carry a small "♀" so they're distinguishable without relying on colour alone.
  const glyph = womenStaff ? '♀' : '+'
  return L.divIcon({
    className: '',
    iconSize: [36, 44],
    iconAnchor: [18, 42],
    popupAnchor: [0, -38],
    html: `<svg width="36" height="44" viewBox="0 0 36 44" aria-hidden="true">
      <path d="M18 43s15-14.5 15-26A15 15 0 0 0 3 17c0 11.5 15 26 15 26z" fill="${fill}" stroke="${colors.cream}" stroke-width="2.5"/>
      <text x="18" y="22" text-anchor="middle" font-size="16" font-weight="700" fill="${colors.cream}" font-family="system-ui">${glyph}</text>
    </svg>`,
  })
}

export type MapCase = { id: string; lat: number | null; lng: number | null; status: string }

function caseColor(status: string) {
  if (status === 'reunited') return colors.reunited
  if (status === 'escalated_police' || status === 'handover_blocked') return colors.danger
  if (['expired', 'closed_no_match'].includes(status)) return colors.inkSoft
  return colors.terracotta
}

export function SafePointMap({
  points,
  cases = [],
  className = 'h-[60vh] min-h-80',
}: {
  points: SafePoint[]
  cases?: MapCase[]
  className?: string
}) {
  const { t, lang } = useI18n()
  return (
    <MapContainer
      center={[DEMO_CENTER.lat, DEMO_CENTER.lng]}
      zoom={16}
      scrollWheelZoom
      className={`${className} w-full rounded-2xl border border-sand-deep`}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {points.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={pinIcon(p.women_staff)} title={p.name_en}>
          <Popup>
            <div className="space-y-1">
              <p className="font-bold text-base">{lang === 'ur' && p.name_ur ? p.name_ur : p.name_en}</p>
              <p className="text-ink-soft">{t(`kinds.${p.kind}`)}</p>
              {p.women_staff && <p className="font-semibold">♀ {t('admin.behanDesk')}</p>}
            </div>
          </Popup>
        </Marker>
      ))}
      {cases
        .filter((c) => c.lat != null && c.lng != null)
        .map((c) => (
          <CircleMarker
            key={c.id}
            center={[c.lat!, c.lng!]}
            radius={9}
            pathOptions={{ color: colors.cream, weight: 3, fillColor: caseColor(c.status), fillOpacity: 1 }}
          >
            <Tooltip>
              #{c.id.slice(0, 4).toUpperCase()} · {t(`status.${c.status}`)}
            </Tooltip>
          </CircleMarker>
        ))}
    </MapContainer>
  )
}
