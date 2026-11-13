import { describe, expect, it } from 'vitest'
import { directEligible, isDirect, withFlags } from '../supabase/functions/_shared/custody.ts'

const c = (o: Partial<Parameters<typeof directEligible>[0]> = {}) => ({ gender: 'male' as const, age_est: 6, flags: [] as string[], safe_point_id: null, ...o })

describe('R13 direct handover eligibility', () => {
  it('a boy aged 4 or more may stay with the finder', () => {
    expect(directEligible(c())).toBe(true)
    expect(directEligible(c({ age_est: 4 }))).toBe(true)
  })
  it('girls, under-4s and unknown age/gender may not', () => {
    expect(directEligible(c({ gender: 'female' }))).toBe(false)
    expect(directEligible(c({ age_est: 3 }))).toBe(false)
    expect(directEligible(c({ flags: ['under_4'] }))).toBe(false)
    expect(directEligible(c({ age_est: null }))).toBe(false)
    expect(directEligible(c({ gender: null }))).toBe(false)
  })
  it('direct only while flagged and no safe point is involved', () => {
    expect(isDirect(c({ flags: ['with_finder'] }))).toBe(true)
    expect(isDirect(c())).toBe(false)
    expect(isDirect(c({ flags: ['with_finder'], safe_point_id: 'sp1' }))).toBe(false)
    expect(isDirect(c({ flags: ['with_finder'], gender: 'female' }))).toBe(false)
  })
  it('withFlags adds and removes without duplicates', () => {
    expect(withFlags(['a', 'with_finder'], ['in_custody', 'a'], ['with_finder'])).toEqual(['a', 'in_custody'])
  })
})
