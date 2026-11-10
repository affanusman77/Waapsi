// Extraction schema, validation of LLM output, and the keyword fallback (R6: fail open).
// Pure TypeScript, no imports: runs in Deno and Vitest.

export const COLOURS = ['red', 'blue', 'green', 'yellow', 'white', 'black', 'pink', 'orange', 'purple', 'brown', 'grey'] as const
export type Colour = (typeof COLOURS)[number]

export type Clothing = {
  top_color?: Colour | null
  top_type?: string | null
  bottom_color?: Colour | null
  bottom_type?: string | null
  other?: string[]
}

export type Extract = {
  child_name: string | null
  father_name: string | null
  age_est: number | null
  gender: 'male' | 'female' | null
  clothing: Clothing
  home_area: string | null
  languages: string[]
  distress_signals: string[]
  missing_fields: string[]
  summary_en: string | null
  summary_ur: string | null
}

// Urdu / Punjabi / Saraiki / Roman-Urdu colour words -> fixed vocabulary (spec section 7).
const COLOUR_WORDS: Record<string, Colour> = {
  red: 'red', laal: 'red', lal: 'red', surkh: 'red', 'لال': 'red', 'سرخ': 'red',
  blue: 'blue', neela: 'blue', nila: 'blue', neeli: 'blue', nili: 'blue', 'نیلا': 'blue', 'نیلی': 'blue',
  green: 'green', hara: 'green', hari: 'green', sabz: 'green', 'ہرا': 'green', 'ہری': 'green', 'سبز': 'green',
  yellow: 'yellow', peela: 'yellow', pila: 'yellow', peeli: 'yellow', pili: 'yellow', 'پیلا': 'yellow', 'پیلی': 'yellow',
  white: 'white', safed: 'white', sufaid: 'white', chitta: 'white', chitti: 'white', 'سفید': 'white', 'چٹا': 'white',
  black: 'black', kala: 'black', kaala: 'black', kali: 'black', kaali: 'black', 'کالا': 'black', 'کالی': 'black',
  pink: 'pink', gulabi: 'pink', 'گلابی': 'pink',
  orange: 'orange', narangi: 'orange', 'نارنجی': 'orange',
  purple: 'purple', jamni: 'purple', 'جامنی': 'purple',
  brown: 'brown', bhura: 'brown', bhoora: 'brown', 'بھورا': 'brown', 'بھوری': 'brown',
  grey: 'grey', gray: 'grey', surmai: 'grey', 'سرمئی': 'grey',
}

const TOP_TYPES: Record<string, string> = {
  shirt: 'shirt', tshirt: 'shirt', 't-shirt': 'shirt', 'شرٹ': 'shirt',
  kameez: 'kameez', qameez: 'kameez', kurta: 'kameez', 'قمیض': 'kameez', 'کرتا': 'kameez',
  frock: 'frock', 'فراک': 'frock', sweater: 'sweater', jacket: 'jacket', jersey: 'sweater',
}
const BOTTOM_TYPES: Record<string, string> = {
  shalwar: 'shalwar', salwar: 'shalwar', 'شلوار': 'shalwar',
  pant: 'trousers', pants: 'trousers', trouser: 'trousers', trousers: 'trousers', pajama: 'trousers', 'پاجامہ': 'trousers', 'پینٹ': 'trousers',
  jeans: 'jeans', shorts: 'shorts', nicker: 'shorts', nikkar: 'shorts',
}

const MALE = /\b(larka|larkaa|ladka|beta|munda|boy|son|putar|puttar)\b|لڑکا|بیٹا|منڈا/i
const FEMALE = /\b(larki|ladki|beti|bachi|bachchi|kuri|kudi|girl|daughter|dhee|dhi)\b|لڑکی|بیٹی|بچی|کڑی/i
const LANGS: Record<string, string> = {
  saraiki: 'saraiki', seraiki: 'saraiki', 'سرائیکی': 'saraiki',
  punjabi: 'punjabi', 'پنجابی': 'punjabi',
  urdu: 'urdu', 'اردو': 'urdu',
  pashto: 'pashto', 'پشتو': 'pashto',
  sindhi: 'sindhi', 'سندھی': 'sindhi',
}
const NAME_STOP = new Set(['hai', 'he', 'is', 'ka', 'ki', 'ke', 'bata', 'batata', 'batati', 'bta', 'raha', 'rahi', 'nahi', 'mera', 'meri', 'uska', 'uski', 'the', 'my', 'his', 'her', 'naam', 'name'])

function toAsciiDigits(s: string) {
  return s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}
const cap = (w: string) => (/^[a-z]/i.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)

function nameAfter(text: string, cue: RegExp): string | null {
  const m = text.match(cue)
  if (!m) return null
  const word = m[1]
  return word && !NAME_STOP.has(word.toLowerCase()) ? cap(word) : null
}

/** Regex/keyword extraction. Deliberately conservative: unknown stays null. */
export function keywordExtract(input: string): Extract {
  const text = toAsciiDigits(input ?? '')
  const lower = text.toLowerCase()
  const tokens = lower.split(/[^\p{L}\p{N}-]+/u).filter(Boolean)

  // Age: "5 saal", "5 sal ka", "5 years", "5 برس"
  const ageM = lower.match(/(\d{1,2})\s*(?:saal|sal|saala|years?|yrs?|baras|برس|سال)/u)
  const age = ageM ? Number(ageM[1]) : null

  const gender: Extract['gender'] = FEMALE.test(text) ? 'female' : MALE.test(text) ? 'male' : null

  // Clothing: a colour within 2 tokens of a garment word.
  const clothing: Clothing = { other: [] }
  tokens.forEach((tok, i) => {
    const top = TOP_TYPES[tok]
    const bottom = BOTTOM_TYPES[tok]
    if (!top && !bottom) return
    const near = [tokens[i - 1], tokens[i - 2], tokens[i + 1], tokens[i + 2]].map((w) => (w ? COLOUR_WORDS[w] : undefined)).find(Boolean)
    if (top && !clothing.top_type) {
      clothing.top_type = top
      if (near) clothing.top_color = near
    } else if (bottom && !clothing.bottom_type) {
      clothing.bottom_type = bottom
      if (near) clothing.bottom_color = near
    }
  })
  if (!clothing.top_color && !clothing.bottom_color) {
    const firstColour = tokens.map((w) => COLOUR_WORDS[w]).find(Boolean)
    if (firstColour) clothing.top_color = firstColour
  }

  // Father first, so "abu ka naam Raza" isn't read as the child's name.
  const father =
    nameAfter(text, /(?:abu|abbu|abba|ammi ke shohar|father|walid|baba|baap|ابو|ابا|والد)(?:\s+(?:ka|ki|ke|کا))?(?:\s+(?:naam|name|nam|نام))?(?:\s+(?:is|hai|ہے))?\s+([\p{L}]+)/iu) ?? null
  const withoutFather = father ? text.replace(new RegExp(`(?:abu|abbu|abba|father|walid|baba|baap|ابو|ابا|والد)[^,.]*?${father}`, 'iu'), ' ') : text
  const child =
    nameAfter(withoutFather, /(?:naam|name|nam|نام)(?:\s+(?:is|hai|ہے))?\s+([\p{L}]+)/iu) ??
    nameAfter(withoutFather, /([\p{L}]+)\s+(?:naam|name)\b/iu)

  const languages = [...new Set(tokens.map((w) => LANGS[w]).filter(Boolean))]
  const distress = /\b(ro raha|ro rahi|rona|crying|dara|scared|dar raha|dar rahi)\b/i.test(lower) ? ['crying'] : []

  const base: Extract = {
    child_name: child,
    father_name: father,
    age_est: age !== null && age <= 18 ? age : null,
    gender,
    clothing,
    home_area: null,
    languages,
    distress_signals: distress,
    missing_fields: [],
    summary_en: null,
    summary_ur: null,
  }
  base.missing_fields = missingFields(base)
  return base
}

/** Fields that matter most for a match, in the order a finder should ask about them. */
export const FIELD_PRIORITY = ['child_name', 'father_name', 'home_area', 'age_est', 'gender', 'clothing'] as const

export function missingFields(e: Pick<Extract, 'child_name' | 'father_name' | 'home_area' | 'age_est' | 'gender' | 'clothing'>): string[] {
  return FIELD_PRIORITY.filter((f) => {
    if (f === 'clothing') return !e.clothing?.top_color && !e.clothing?.bottom_color
    return e[f] === null || e[f] === undefined || e[f] === ''
  })
}

const str = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() && !/^(null|unknown|n\/a|none)$/i.test(v.trim()) ? v.trim().slice(0, max) : null)
const colour = (v: unknown): Colour | null => {
  const s = str(v)?.toLowerCase()
  if (!s) return null
  return (COLOURS as readonly string[]).includes(s) ? (s as Colour) : (COLOUR_WORDS[s] ?? null)
}
const strList = (v: unknown, max = 8) => (Array.isArray(v) ? v.map((x) => str(x, 40)).filter((x): x is string => !!x).slice(0, max) : [])

/**
 * Validates and cleans untrusted LLM JSON into an Extract (the "zod" step, hand-rolled so it
 * also runs in Vitest). Returns null if it isn't a usable object; bad fields become null.
 */
export function normalizeExtract(raw: unknown): Extract | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const c = (r.clothing && typeof r.clothing === 'object' ? r.clothing : {}) as Record<string, unknown>
  const ageN = typeof r.age_est === 'number' ? r.age_est : typeof r.age_est === 'string' ? Number(r.age_est) : NaN
  const g = str(r.gender)?.toLowerCase()
  const out: Extract = {
    child_name: str(r.child_name_roman) ? cap(str(r.child_name_roman)!) : str(r.child_name),
    father_name: str(r.father_name_roman) ? cap(str(r.father_name_roman)!) : str(r.father_name),
    age_est: Number.isFinite(ageN) && ageN >= 0 && ageN <= 18 ? Math.round(ageN) : null,
    gender: g === 'male' || g === 'female' ? g : null,
    clothing: {
      top_color: colour(c.top_color),
      top_type: str(c.top_type, 30)?.toLowerCase() ?? null,
      bottom_color: colour(c.bottom_color),
      bottom_type: str(c.bottom_type, 30)?.toLowerCase() ?? null,
      other: strList(c.other),
    },
    home_area: str(r.home_area, 120),
    languages: strList(r.languages).map((l) => l.toLowerCase()),
    distress_signals: strList(r.distress_signals),
    missing_fields: [],
    summary_en: str(r.summary_en, 400),
    summary_ur: str(r.summary_ur, 400),
  }
  out.missing_fields = missingFields(out)
  return out
}
