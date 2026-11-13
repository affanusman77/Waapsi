// Geofenced missing-child alerts for verified responders (see _shared/geofence.ts).
//   sp_staff : open missing-child reports whose last-seen point is within 20 km of their safe point
//   police / admin : every open missing-child report, with how many safe points were alerted
// Everyone else gets 403: the public never sees these alerts.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { buildAlerts, GEOFENCE_KM, type LostCaseLite, type SafePointLite } from '../_shared/geofence.ts'

const OPEN_LOST = ['reported', 'matched', 'escalated_police']

Deno.serve(
  handle(async (req) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    if (!['sp_staff', 'police', 'admin'].includes(caller.role)) throw new HttpError(403, 'not_allowed')

    const { data: points } = await admin.from('safe_points').select('id, name_en, name_ur, lat, lng').eq('active', true)
    const sps = (points ?? []) as SafePointLite[]

    let viewer: { lat: number; lng: number } | null = null
    if (caller.role === 'sp_staff') {
      const own = sps.find((p) => p.id === caller.safe_point_id)
      if (!own) return json({ radius_km: GEOFENCE_KM, alerts: [] })
      viewer = { lat: own.lat, lng: own.lng }
    }

    const { data: cases } = await admin
      .from('cases')
      .select('id, gender, age_est, clothing, lat, lng, seen_at, status, flags')
      .eq('kind', 'lost')
      .in('status', OPEN_LOST)
      .gte('seen_at', new Date(Date.now() - 24 * 3600_000).toISOString())
      .order('seen_at', { ascending: false })
      .limit(200)

    return json({ radius_km: GEOFENCE_KM, alerts: buildAlerts((cases ?? []) as LostCaseLite[], sps, viewer) })
  }),
)
