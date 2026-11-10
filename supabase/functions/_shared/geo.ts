// Pure geo helpers shared by the frontend (src/lib/geo.ts) and edge functions. No imports.

export type LatLng = { lat: number; lng: number }

export type SafePointLike = LatLng & {
  id: string
  women_staff: boolean
  active: boolean
}

const EARTH_RADIUS_M = 6_371_000

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Nearest active safe points, closest first.
 * R4 (girls' protocol): if the child is female, ONLY points with women staff are returned.
 */
export function nearestSafePoints<T extends SafePointLike>(
  points: readonly T[],
  from: LatLng,
  gender: 'male' | 'female' | null | undefined,
  limit = 3,
): Array<T & { distance_m: number }> {
  return points
    .filter((p) => p.active && (gender !== 'female' || p.women_staff))
    .map((p) => ({ ...p, distance_m: haversineMeters(from, p) }))
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit)
}

/** Rough walking time at ~4.5 km/h, rounded up to whole minutes (min 1). */
export function walkingMinutes(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / 75))
}
