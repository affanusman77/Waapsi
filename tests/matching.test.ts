import { describe, expect, it } from 'vitest'
import {
  STRONG_THRESHOLD,
  SUGGEST_THRESHOLD,
  isValidWristNumber,
  jaroWinkler,
  nameSimilarity,
  normName,
  scoreMatch,
  type MatchableCase,
} from '../supabase/functions/_shared/matching.ts'

const t0 = '2026-11-10T10:00:00Z'
const plus = (min: number) => new Date(Date.parse(t0) + min * 60_000).toISOString()

const found: MatchableCase = {
  id: 'f',
  kind: 'found',
  child_name: 'Ali',
  father_name: 'Raza',
  age_est: 5,
  gender: 'male',
  clothing: { top_color: 'red', top_type: 'shirt' },
  lat: 30.1962,
  lng: 71.4738,
  seen_at: plus(40),
}
const checkin: MatchableCase = {
  id: 'c',
  kind: 'checkin',
  child_name: 'Aly',
  father_name: 'Rza',
  age_est: 5,
  gender: 'male',
  clothing: { top_color: 'red', top_type: 'shirt' },
  lat: 30.2002,
  lng: 71.469,
  seen_at: t0,
}

describe('normName', () => {
  it('normalises Roman Urdu spellings', () => {
    expect(normName('Mohd Usman')).toBe(normName('Muhammad Usman'))
    expect(normName('Muhammed')).toBe('mhmd')
    expect(normName('Zainabh')).toBe(normName('Zainab'))
    expect(normName('Aly')).toBe(normName('Ali'))
    expect(normName('Sheeraz')).toBe(normName('Shiraz'))
  })
})

describe('name similarity', () => {
  it('Aly Rza ≈ Ali Raza', () => {
    expect(nameSimilarity('Aly Rza', 'Ali Raza')!).toBeGreaterThanOrEqual(0.85)
  })
  it('Mohd Usman ≈ Muhammad Usman', () => {
    expect(nameSimilarity('Mohd Usman', 'Muhammad Usman')).toBe(1)
  })
  it('Zainab ≠ Zubair', () => {
    expect(nameSimilarity('Zainab', 'Zubair')!).toBeLessThan(0.75)
  })
  it('missing names give null, not 0', () => {
    expect(nameSimilarity(null, 'Ali')).toBeNull()
  })
  it('jaroWinkler basics', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2)
    expect(jaroWinkler('abc', 'xyz')).toBe(0)
  })
})

describe('scoreMatch', () => {
  it('the demo story: found "Ali Raza, 5, red shirt" vs check-in "Aly Rza" is a strong match', () => {
    const r = scoreMatch(found, checkin)!
    expect(r.score).toBeGreaterThanOrEqual(STRONG_THRESHOLD)
    expect(r.strong).toBe(true)
    expect(r.reasons.map((x) => x.factor)).toEqual(expect.arrayContaining(['child_name', 'father_name', 'age', 'clothing', 'distance', 'time']))
    expect(r.reasons.find((x) => x.factor === 'clothing')!.text_en).toMatch(/Red shirt matches today's check-in photo/)
  })

  it('gender is a hard filter', () => {
    expect(scoreMatch(found, { ...checkin, gender: 'female' })).toBeNull()
  })

  it('outside the 12 h window or 10 km -> no match', () => {
    expect(scoreMatch(found, { ...checkin, seen_at: plus(-13 * 60) })).toBeNull()
    expect(scoreMatch(found, { ...checkin, lat: 30.4 })).toBeNull()
  })

  it('missing data is skipped and weights re-normalised (not penalised)', () => {
    const noFather = scoreMatch({ ...found, father_name: null }, { ...checkin, father_name: null })!
    expect(noFather.reasons.some((r) => r.factor === 'father_name')).toBe(false)
    expect(noFather.score).toBeGreaterThanOrEqual(STRONG_THRESHOLD)
  })

  it('check-in clothing counts x1.25 (capped at 1)', () => {
    const half = { top_color: 'red', top_type: 'kameez' }
    const asLost = scoreMatch({ ...found, clothing: { top_color: 'red', top_type: 'shirt' } }, { ...checkin, kind: 'lost', clothing: half })!
    const asCheckin = scoreMatch({ ...found, clothing: { top_color: 'red', top_type: 'shirt' } }, { ...checkin, clothing: half })!
    const c1 = asLost.reasons.find((r) => r.factor === 'clothing')!.score
    const c2 = asCheckin.reasons.find((r) => r.factor === 'clothing')!.score
    expect(c1).toBe(0.5)
    expect(c2).toBe(0.625)
  })

  it('same place and time alone is NOT enough evidence', () => {
    const bare = { ...checkin, child_name: null, father_name: null, clothing: null }
    expect(scoreMatch({ ...found, child_name: null, father_name: null, clothing: null }, bare)).toBeNull()
  })

  it('a different child nearby scores below the suggest threshold', () => {
    const other = { ...checkin, child_name: 'Zubair', father_name: 'Kamran', age_est: 9, clothing: { top_color: 'blue', top_type: 'kameez' } }
    expect(scoreMatch(found, other)!.score).toBeLessThan(SUGGEST_THRESHOLD)
  })

  it('threshold boundaries', () => {
    expect(SUGGEST_THRESHOLD).toBe(0.6)
    expect(STRONG_THRESHOLD).toBe(0.8)
  })
})

describe('wrist number', () => {
  it('accepts only 03XXXXXXXXX', () => {
    expect(isValidWristNumber('03001234567')).toBe(true)
    expect(isValidWristNumber('0300123456')).toBe(false)
    expect(isValidWristNumber('+923001234567')).toBe(false)
  })
})
