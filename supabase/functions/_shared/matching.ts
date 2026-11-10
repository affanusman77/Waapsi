// Deterministic matching (spec section 8). Pure TypeScript, no AI dependency, unit-tested.
// AI suggests (this score), humans decide (finder confirm + safe point verification, R3).
import { haversineMeters } from './geo.ts'

export type MatchableCase = {
  id: string
  kind: 'found' | 'lost' | 'checkin'
  child_name?: string | null
  father_name?: string | null
  age_est?: number | null
  gender?: 'male' | 'female' | null
  clothing?: {
    top_color?: string | null
    top_type?: string | null
    bottom_color?: string | null
    bottom_type?: string | null
  } | null
  lat?: number | null
  lng?: number | null
  seen_at: string // ISO
}

export type Reason = { factor: string; score: number; text_en: string; text_ur: string }
export type MatchResult = { score: number; strong: boolean; reasons: Reason[] }

export const SUGGEST_THRESHOLD = 0.6
export const STRONG_THRESHOLD = 0.8
const WINDOW_MS = 12 * 3600 * 1000
const MAX_DISTANCE_M = 10_000

const WEIGHTS = { child_name: 0.25, father_name: 0.15, age: 0.15, clothing: 0.2, distance: 0.15, time: 0.1 } as const

// ---------- names ----------

/** Roman-Urdu name normalisation: "Aly Rza" ≈ "Ali Raza", "Mohd Usman" ≈ "Muhammad Usman". */
export function normName(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^(muhammad|mohammad|muhammed|mohammed|mohamad|muhamad|mohd|muhd|md)$/.test(w)) return 'mhmd'
      let s = w
      s = s.replace(/ee/g, 'i').replace(/oo/g, 'u')
      // vowel-insensitive core: Roman Urdu spells short vowels inconsistently (Rza / Raza)
      s = s.replace(/(?<=.)y(?=.)/g, 'i') // word-internal y -> i
      s = s.replace(/([^aeiou])w/g, '$1u') // w after a consonant -> u
      s = s.replace(/(.)\1+/g, '$1') // collapse doubles
      s = s.replace(/(?<=.)h$/, '') // drop trailing h (Zainab/Zainabh, Aliyah)
      s = s.replace(/(?<=.)y$/, 'i') // Aly -> Ali
      return s
    })
    .join(' ')
}

/** Consonant skeleton, used as a second opinion so dropped vowels (Rza vs Raza) still match. */
function skeleton(norm: string) {
  return norm
    .split(' ')
    .map((w) => w[0] + w.slice(1).replace(/[aeiou]/g, ''))
    .join(' ')
}

export function jaroWinkler(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aM = new Array<boolean>(a.length).fill(false)
  const bM = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bM[j] && a[i] === b[j]) {
        aM[i] = bM[j] = true
        matches++
        break
      }
    }
  }
  if (!matches) return 0
  let t = 0
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aM[i]) continue
    while (!bM[k]) k++
    if (a[i] !== b[k++]) t++
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && a[prefix] && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number | null {
  const na = normName(a)
  const nb = normName(b)
  if (!na || !nb) return null
  return Math.max(jaroWinkler(na, nb), jaroWinkler(skeleton(na), skeleton(nb)) * 0.97)
}

// ---------- other factors ----------

const TYPE_FAMILY: Record<string, string> = { kurta: 'kameez', qameez: 'kameez', tshirt: 'shirt', 't-shirt': 'shirt', pants: 'trousers', pant: 'trousers', pajama: 'trousers' }
const fam = (t?: string | null) => (t ? (TYPE_FAMILY[t.toLowerCase()] ?? t.toLowerCase()) : null)

function clothingScore(a: MatchableCase['clothing'], b: MatchableCase['clothing']): { score: number; matched: string[] } | null {
  if (!a || !b) return null
  const pairs: Array<[string, string | null | undefined, string | null | undefined]> = [
    ['top_color', a.top_color, b.top_color],
    ['top_type', fam(a.top_type), fam(b.top_type)],
    ['bottom_color', a.bottom_color, b.bottom_color],
    ['bottom_type', fam(a.bottom_type), fam(b.bottom_type)],
  ]
  const known = pairs.filter(([, x, y]) => x && y)
  if (!known.length) return null
  const matched = known.filter(([, x, y]) => x === y).map(([f]) => f)
  return { score: matched.length / known.length, matched }
}

function distanceScore(m: number) {
  if (m <= 500) return 1
  if (m >= 5000) return 0
  return 1 - (m - 500) / 4500
}

/** Found relative to last-seen: 15 min before to 6 h after -> 1, then linear decay to 0 at the 12 h window edge. */
function timeScore(foundMs: number, seenMs: number) {
  const d = foundMs - seenMs
  if (d >= -15 * 60_000 && d <= 6 * 3600_000) return 1
  if (d > 6 * 3600_000) return Math.max(0, 1 - (d - 6 * 3600_000) / (6 * 3600_000))
  return Math.max(0, 1 - (-d - 15 * 60_000) / (2 * 3600_000))
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const COLOUR_UR: Record<string, string> = { red: 'لال', blue: 'نیلی', green: 'ہری', yellow: 'پیلی', white: 'سفید', black: 'کالی', pink: 'گلابی', orange: 'نارنجی', purple: 'جامنی', brown: 'بھوری', grey: 'سرمئی' }

/**
 * Scores a found case against a lost/check-in case. Returns null if they can't be the same
 * child (window, distance, gender) or there isn't enough evidence to say anything.
 */
export function scoreMatch(found: MatchableCase, lost: MatchableCase): MatchResult | null {
  const foundMs = Date.parse(found.seen_at)
  const seenMs = Date.parse(lost.seen_at)
  if (Math.abs(foundMs - seenMs) > WINDOW_MS) return null

  // Gender is a hard filter (both known and different -> no match).
  if (found.gender && lost.gender && found.gender !== lost.gender) return null

  let distM: number | null = null
  if (found.lat != null && found.lng != null && lost.lat != null && lost.lng != null) {
    distM = haversineMeters({ lat: found.lat, lng: found.lng }, { lat: lost.lat, lng: lost.lng })
    if (distM > MAX_DISTANCE_M) return null
  }

  const reasons: Reason[] = []
  const add = (factor: keyof typeof WEIGHTS, score: number, text_en: string, text_ur: string) =>
    reasons.push({ factor, score: Math.max(0, Math.min(1, score)), text_en, text_ur })

  const n1 = nameSimilarity(found.child_name, lost.child_name)
  if (n1 !== null) add('child_name', n1, `Name: ${found.child_name} ≈ ${lost.child_name} (${pct(n1)})`, `نام: ${found.child_name} ≈ ${lost.child_name} (${pct(n1)})`)

  const n2 = nameSimilarity(found.father_name, lost.father_name)
  if (n2 !== null) add('father_name', n2, `Father: ${found.father_name} ≈ ${lost.father_name} (${pct(n2)})`, `والد: ${found.father_name} ≈ ${lost.father_name} (${pct(n2)})`)

  if (found.age_est != null && lost.age_est != null) {
    const diff = Math.abs(found.age_est - lost.age_est)
    add('age', diff <= 1 ? 1 : diff <= 2 ? 0.5 : 0, `Age: about ${found.age_est} vs ${lost.age_est}`, `عمر: تقریباً ${found.age_est} اور ${lost.age_est}`)
  }

  const cl = clothingScore(found.clothing, lost.clothing)
  if (cl) {
    // A check-in photo is from TODAY, so matching clothes count for more (capped at 1).
    const s = lost.kind === 'checkin' ? Math.min(1, cl.score * 1.25) : cl.score
    const top = found.clothing?.top_color && cl.matched.includes('top_color') ? found.clothing.top_color : null
    const what = top ? `${top} ${found.clothing?.top_type ?? 'clothes'}` : 'Clothes'
    const today = lost.kind === 'checkin' ? " today's check-in photo" : ' the description'
    add(
      'clothing',
      s,
      cl.matched.length ? `${what[0].toUpperCase()}${what.slice(1)} matches${today}` : 'Clothes don’t match',
      cl.matched.length ? `${top ? COLOUR_UR[top] ?? '' : ''} کپڑے ${lost.kind === 'checkin' ? 'آج کی تصویر' : 'بیان'} سے ملتے ہیں` : 'کپڑے نہیں ملتے',
    )
  }

  const gapMin = Math.round(Math.abs(foundMs - seenMs) / 60_000)
  const gapText = gapMin < 60 ? `${gapMin} min` : `${Math.floor(gapMin / 60)} h ${gapMin % 60} min`
  if (distM !== null) {
    const d = distM < 1000 ? `${Math.round(distM / 10) * 10} m` : `${(distM / 1000).toFixed(1)} km`
    add('distance', distanceScore(distM), `${d} apart, ${gapText} gap`, `${d} کا فاصلہ، ${gapText} کا وقفہ`)
  }
  add('time', timeScore(foundMs, seenMs), `Found ${gapText} ${foundMs >= seenMs ? 'after' : 'before'} last seen`, `آخری بار دیکھنے سے ${gapText} ${foundMs >= seenMs ? 'بعد' : 'پہلے'} ملا`)

  // Evidence guard: re-normalising weights must not turn "same area, same time" alone into a
  // confident match. Require an identity factor (a name or clothes) and at least 3 factors.
  const identity = reasons.some((r) => r.factor === 'child_name' || r.factor === 'father_name' || r.factor === 'clothing')
  if (!identity || reasons.length < 3) return null

  // Missing data is skipped and the remaining weights re-normalised (don't penalise missing data).
  const totalW = reasons.reduce((s, r) => s + WEIGHTS[r.factor as keyof typeof WEIGHTS], 0)
  const score = reasons.reduce((s, r) => s + r.score * WEIGHTS[r.factor as keyof typeof WEIGHTS], 0) / totalW
  const rounded = Math.round(score * 1000) / 1000
  return { score: rounded, strong: rounded >= STRONG_THRESHOLD, reasons: reasons.sort((a, b) => b.score - a.score) }
}

/** Wrist-number shortcut (P6): a valid Pakistani mobile written on the child's wrist. */
export function isValidWristNumber(s: string | null | undefined): boolean {
  return !!s && /^03\d{9}$/.test(s)
}
