import { describe, expect, it } from 'vitest'
import { keywordExtract, missingFields, normalizeExtract } from '../supabase/functions/_shared/extract-fallback.ts'

describe('keywordExtract', () => {
  it('"5 saal ka larka laal shirt naam Ali" -> age 5, male, red, Ali', () => {
    const e = keywordExtract('5 saal ka larka laal shirt naam Ali')
    expect(e.age_est).toBe(5)
    expect(e.gender).toBe('male')
    expect(e.clothing.top_color).toBe('red')
    expect(e.clothing.top_type).toBe('shirt')
    expect(e.child_name).toBe('Ali')
  })

  it('the demo voice line: child + father name', () => {
    const e = keywordExtract('Ye bacha mila hai, naam Ali bata raha, abu ka naam Raza, Hussain Agahi ke paas.')
    expect(e.child_name).toBe('Ali')
    expect(e.father_name).toBe('Raza')
  })

  it('girls and Urdu script', () => {
    const e = keywordExtract('بچی ملی ہے، نام عائشہ، ۴ سال، گلابی فراک')
    expect(e.gender).toBe('female')
    expect(e.age_est).toBe(4)
    expect(e.child_name).toBe('عائشہ')
    expect(e.clothing.top_color).toBe('pink')
    expect(e.clothing.top_type).toBe('frock')
  })

  it('Saraiki/Punjabi colour words and bottoms', () => {
    const e = keywordExtract('chitti kameez te kali shalwar, saraiki bolda')
    expect(e.clothing.top_color).toBe('white')
    expect(e.clothing.bottom_type).toBe('shalwar')
    expect(e.clothing.bottom_color).toBe('black')
    expect(e.languages).toContain('saraiki')
  })

  it('unknown stays null', () => {
    const e = keywordExtract('bacha ro raha hai')
    expect(e.child_name).toBeNull()
    expect(e.age_est).toBeNull()
    expect(e.distress_signals).toContain('crying')
    expect(e.missing_fields[0]).toBe('child_name')
  })
})

describe('normalizeExtract (LLM output validation)', () => {
  it('cleans and coerces', () => {
    const e = normalizeExtract({
      child_name: 'علی',
      child_name_roman: 'ali',
      father_name_roman: 'raza',
      age_est: '5',
      gender: 'Male',
      clothing: { top_color: 'laal', top_type: 'Shirt', bottom_color: 'purple-ish' },
      languages: ['Saraiki'],
      summary_en: 'Boy, 5',
    })!
    expect(e.child_name).toBe('Ali')
    expect(e.father_name).toBe('Raza')
    expect(e.age_est).toBe(5)
    expect(e.gender).toBe('male')
    expect(e.clothing.top_color).toBe('red')
    expect(e.clothing.bottom_color).toBeNull()
    expect(e.languages).toEqual(['saraiki'])
  })
  it('rejects garbage', () => {
    expect(normalizeExtract('not json')).toBeNull()
    expect(normalizeExtract([1, 2])).toBeNull()
    expect(normalizeExtract({ age_est: 99, gender: 'robot', child_name: 'null' })!.age_est).toBeNull()
  })
  it('missingFields order', () => {
    expect(missingFields({ child_name: 'Ali', father_name: null, home_area: null, age_est: 5, gender: 'male', clothing: {} })).toEqual([
      'father_name',
      'home_area',
      'clothing',
    ])
  })
})
