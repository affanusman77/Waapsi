import { describe, expect, it } from 'vitest'
import { haversineMeters, nearestSafePoints, walkingMinutes } from '../supabase/functions/_shared/geo.ts'

const points = [
  { id: 'shrine', lat: 30.2002, lng: 71.469, women_staff: true, active: true },
  { id: 'ghanta', lat: 30.1978, lng: 71.4698, women_staff: false, active: true },
  { id: 'shop12', lat: 30.1962, lng: 71.4738, women_staff: false, active: true },
  { id: 'edhi', lat: 30.194, lng: 71.4655, women_staff: true, active: true },
  { id: 'closed', lat: 30.1977, lng: 71.4697, women_staff: true, active: false },
]
const nearGhantaGhar = { lat: 30.1976, lng: 71.4699 }

describe('haversineMeters', () => {
  it('is zero for the same point and ~111 km per degree of latitude', () => {
    expect(haversineMeters(nearGhantaGhar, nearGhantaGhar)).toBe(0)
    expect(haversineMeters({ lat: 30, lng: 71 }, { lat: 31, lng: 71 })).toBeCloseTo(111_195, -2)
  })
})

describe('nearestSafePoints', () => {
  it('returns the closest active point first for a boy', () => {
    const res = nearestSafePoints(points, nearGhantaGhar, 'male')
    expect(res[0].id).toBe('ghanta')
    expect(res.map((p) => p.id)).not.toContain('closed')
  })

  it('girls protocol (R4): only women-staff points for a girl', () => {
    const res = nearestSafePoints(points, nearGhantaGhar, 'female', 10)
    expect(res.length).toBeGreaterThan(0)
    expect(res.every((p) => p.women_staff)).toBe(true)
    expect(res.map((p) => p.id)).toEqual(['shrine', 'edhi'])
  })

  it('unknown gender is not filtered', () => {
    expect(nearestSafePoints(points, nearGhantaGhar, null, 10)).toHaveLength(4)
  })
})

describe('walkingMinutes', () => {
  it('never says 0 minutes', () => {
    expect(walkingMinutes(10)).toBe(1)
    expect(walkingMinutes(750)).toBe(10)
  })
})
