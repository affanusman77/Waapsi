// Geofenced missing-child alerts (added 2026-11-12). When a child is reported missing, verified
// responders within GEOFENCE_KM of the last-seen point are alerted: safe point staff (in the app +
// WhatsApp) and police (they already get every case). NEVER the public.
// Alerts carry no name, no photo, no father's name and no exact location: only what a responder
// needs to recognise a child who is brought to them (boy/girl, age, clothes, nearest landmark).
// Pure TypeScript, no imports: runs in Deno and Vitest.

export const GEOFENCE_KM = 20

export type Point = { lat: number; lng: number }
export type SafePointLite = Point & { id: string; name_en: string; name_ur?: string | null }
export type LostCaseLite = {
  id: string
  gender: 'male' | 'female' | null
  age_est: number | null
  clothing: { top_color?: string | null; top_type?: string | null; bottom_color?: string | null; bottom_type?: string | null } | null
  lat: number | null
  lng: number | null
  seen_at: string
  status: string
  flags: string[] | null
}
export type GeofenceAlert = {
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

export function distanceMeters(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/** Safe points inside the geofence around a last-seen point, nearest first. */
export function safePointsWithin<T extends Point>(center: Point, points: T[], km = GEOFENCE_KM): Array<T & { distance_m: number }> {
  return points
    .map((p) => ({ ...p, distance_m: distanceMeters(center, p) }))
    .filter((p) => p.distance_m <= km * 1000)
    .sort((a, b) => a.distance_m - b.distance_m)
}

/**
 * Builds the alerts a responder should see. `viewer` = the staff member's safe point (only cases
 * whose last-seen point is within the geofence of it); null = police/admin (every open case).
 */
export function buildAlerts(cases: LostCaseLite[], points: SafePointLite[], viewer: Point | null, now = Date.now(), km = GEOFENCE_KM): GeofenceAlert[] {
  const out: GeofenceAlert[] = []
  for (const c of cases) {
    if (c.lat === null || c.lng === null) continue
    const seen = { lat: c.lat, lng: c.lng }
    const inRange = safePointsWithin(seen, points, km)
    const distance = viewer ? distanceMeters(viewer, seen) : null
    if (distance !== null && distance > km * 1000) continue
    out.push({
      case_id: c.id,
      short_id: c.id.slice(0, 6).toUpperCase(),
      gender: c.gender,
      age_est: c.age_est,
      top_color: c.clothing?.top_color ?? null,
      top_type: c.clothing?.top_type ?? null,
      bottom_color: c.clothing?.bottom_color ?? null,
      bottom_type: c.clothing?.bottom_type ?? null,
      under_4: !!c.flags?.includes('under_4') || (c.age_est !== null && c.age_est < 4),
      near_en: inRange[0]?.name_en ?? null,
      near_ur: inRange[0]?.name_ur ?? null,
      distance_m: distance === null ? null : Math.round(distance),
      minutes_ago: Math.max(0, Math.round((now - Date.parse(c.seen_at)) / 60_000)),
      status: c.status,
      responders: inRange.length,
    })
  }
  return out.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0) || a.minutes_ago - b.minutes_ago)
}

/** Short WhatsApp text for safe point staff. No name, no photo, no exact location. */
export function geofenceMessage(a: GeofenceAlert, km = GEOFENCE_KM): string {
  const who = a.gender === 'female' ? 'Girl / bachi' : a.gender === 'male' ? 'Boy / bacha' : 'Child / bacha'
  const age = a.age_est !== null ? `, about ${a.age_est}` : ''
  const clothes = [a.top_color && `${a.top_color} ${a.top_type ?? 'top'}`, a.bottom_color && `${a.bottom_color} ${a.bottom_type ?? 'bottom'}`].filter(Boolean).join(', ')
  return [
    `📍 Wapsi alert: bacha gum / CHILD MISSING within ${km} km (case #${a.short_id})`,
    `${who}${age}${clothes ? ` · ${clothes}` : ''}${a.under_4 ? ' · UNDER 4' : ''}`,
    a.near_en ? `Last seen near: ${a.near_en}` : null,
    'Agar aisa bacha aap ke paas laya jaye, Wapsi app mein accept karein. / If a child like this is brought to you, accept them in Wapsi.',
  ]
    .filter(Boolean)
    .join('\n')
}
