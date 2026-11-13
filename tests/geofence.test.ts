import { describe, expect, it } from 'vitest'
import { buildAlerts, geofenceMessage, safePointsWithin, type LostCaseLite, type SafePointLite } from '../supabase/functions/_shared/geofence.ts'

// Multan demo points + one far away (Lahore, ~300 km).
const SPS: SafePointLite[] = [
  { id: 'gg', name_en: 'Ghanta Ghar Help Desk', lat: 30.1978, lng: 71.4698 },
  { id: 'edhi', name_en: 'Edhi Centre', lat: 30.194, lng: 71.4655 },
  { id: 'lhr', name_en: 'Lahore Desk', lat: 31.5204, lng: 74.3587 },
]
const lost = (over: Partial<LostCaseLite> = {}): LostCaseLite => ({
  id: 'abcdef12-0000',
  gender: 'male',
  age_est: 7,
  clothing: { top_color: 'green', top_type: 'shirt', bottom_color: 'black', bottom_type: 'trousers' },
  lat: 30.1979,
  lng: 71.4697,
  seen_at: new Date(Date.now() - 15 * 60_000).toISOString(),
  status: 'reported',
  flags: [],
  ...over,
})

describe('geofence', () => {
  it('only safe points within 20 km are in range, nearest first', () => {
    const r = safePointsWithin({ lat: 30.1979, lng: 71.4697 }, SPS)
    expect(r.map((p) => p.id)).toEqual(['gg', 'edhi'])
  })

  it('staff see cases within 20 km of their own safe point only', () => {
    expect(buildAlerts([lost()], SPS, SPS[0])).toHaveLength(1)
    expect(buildAlerts([lost()], SPS, SPS[2])).toHaveLength(0) // Lahore desk: too far
  })

  it('police (no viewer point) see every case, with the responder count', () => {
    const [a] = buildAlerts([lost()], SPS, null)
    expect(a.responders).toBe(2)
    expect(a.distance_m).toBeNull()
    expect(a.near_en).toBe('Ghanta Ghar Help Desk')
    expect(a.minutes_ago).toBe(15)
  })

  it('cases without a location are skipped', () => {
    expect(buildAlerts([lost({ lat: null, lng: null })], SPS, null)).toHaveLength(0)
  })

  it('alerts never carry a name, photo or coordinates', () => {
    const [a] = buildAlerts([lost()], SPS, null)
    const text = JSON.stringify(a) + geofenceMessage(a)
    expect(text).not.toMatch(/photo|father|child_name|30\.19|71\.46/i)
    expect(geofenceMessage(a)).toContain('Boy / bacha, about 7 · green shirt, black trousers')
  })
})
