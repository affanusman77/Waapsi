// Face check (pure TypeScript, no imports, so it runs in Deno AND in Vitest).
//
// Rules agreed with the team (2026-11-11):
//   1. Faces are compared ONLY after the matcher has already suggested a match: one found-child photo
//      against one family photo. There is no searchable face database.
//   2. An unclear photo is never compared. We say which photo was unclear and why.
// The result is a HINT shown to the finder / safe point staff. It never changes the match score,
// never confirms a match and never reaches the parent (R2, R3).

/** Subset of Amazon Rekognition's DetectFaces FaceDetail that we read. */
export type DetectedFace = {
  BoundingBox?: { Width?: number; Height?: number; Left?: number; Top?: number }
  Confidence?: number
  Pose?: { Yaw?: number; Pitch?: number; Roll?: number }
  Quality?: { Brightness?: number; Sharpness?: number }
  AgeRange?: { Low?: number; High?: number } // only with Attributes ['ALL']
  Gender?: { Value?: 'Male' | 'Female'; Confidence?: number }
}

/**
 * What a clear photo suggests about the child (photo-check, 2026-11-12). A SUGGESTION for the review
 * form only: whatever the reporter said wins, and boy/girl + age are always confirmed by a person.
 * Age is "unclear" when Rekognition's range is wider than 6 years; gender only when ≥ 90% sure.
 */
export type PhotoEstimate = {
  age_low: number | null
  age_high: number | null
  age_est: number | null // null = range too wide to pick an age band
  gender: 'male' | 'female' | null
  adult: boolean // the face looks 18+ (probably not the child)
}

export function photoEstimate(face: DetectedFace): PhotoEstimate {
  const lo = face.AgeRange?.Low
  const hi = face.AgeRange?.High
  const known = typeof lo === 'number' && typeof hi === 'number'
  const g = face.Gender
  return {
    age_low: known ? lo : null,
    age_high: known ? hi : null,
    age_est: known && hi - lo <= 6 ? Math.round((lo + hi) / 2) : null,
    gender: g?.Value && (g.Confidence ?? 0) >= 90 ? (g.Value === 'Female' ? 'female' : 'male') : null,
    adult: known && lo >= 18,
  }
}

export type UnclearWhy =
  | 'no_face'
  | 'several_faces'
  | 'too_small'
  | 'blurry'
  | 'too_dark'
  | 'too_bright'
  | 'turned_away'
  | 'not_clear'

export type Assessment = { ok: true; face: DetectedFace } | { ok: false; why: UnclearWhy }

/** Thresholds for "clear enough to compare". Rekognition reports Brightness/Sharpness on 0–100. */
export const PHOTO_LIMITS = {
  minConfidence: 90, // % sure it is a face
  minWidth: 0.08, // face width as a share of the photo width
  minSharpness: 20,
  minBrightness: 15,
  maxBrightness: 95,
  maxYaw: 45, // degrees: head turned sideways
  maxPitch: 40, // degrees: head tilted up/down
  rivalArea: 0.5, // a second face at least half the size of the main one makes the photo ambiguous
} as const

const area = (f: DetectedFace) => (f.BoundingBox?.Width ?? 0) * (f.BoundingBox?.Height ?? 0)

/** Decides whether one photo is clear enough to compare, from its DetectFaces result. */
export function assessPhoto(faces: DetectedFace[]): Assessment {
  const seen = faces.filter((f) => (f.Confidence ?? 0) >= 50 && area(f) > 0).sort((a, b) => area(b) - area(a))
  const face = seen.at(0)
  if (!face) return { ok: false, why: 'no_face' }
  const rival = seen.at(1)
  if (rival && area(rival) >= area(face) * PHOTO_LIMITS.rivalArea) return { ok: false, why: 'several_faces' }
  if ((face.Confidence ?? 0) < PHOTO_LIMITS.minConfidence) return { ok: false, why: 'not_clear' }
  if ((face.BoundingBox?.Width ?? 0) < PHOTO_LIMITS.minWidth) return { ok: false, why: 'too_small' }
  const q = face.Quality ?? {}
  if (q.Sharpness !== undefined && q.Sharpness < PHOTO_LIMITS.minSharpness) return { ok: false, why: 'blurry' }
  if (q.Brightness !== undefined && q.Brightness < PHOTO_LIMITS.minBrightness) return { ok: false, why: 'too_dark' }
  if (q.Brightness !== undefined && q.Brightness > PHOTO_LIMITS.maxBrightness) return { ok: false, why: 'too_bright' }
  const p = face.Pose ?? {}
  if (Math.abs(p.Yaw ?? 0) > PHOTO_LIMITS.maxYaw || Math.abs(p.Pitch ?? 0) > PHOTO_LIMITS.maxPitch) return { ok: false, why: 'turned_away' }
  return { ok: true, face }
}

export type FaceBand = 'alike' | 'some' | 'different'
export type FaceStatus = FaceBand | 'unclear' | 'no_photo' | 'error'

/** Similarity (0–100, Rekognition CompareFaces) → band shown to the person deciding. */
export function faceBand(similarity: number): FaceBand {
  if (similarity >= 90) return 'alike'
  if (similarity >= 75) return 'some'
  return 'different'
}

/** Stored in matches.reasons beside the other factors; `factor: 'face'` is never part of the score. */
export type FaceReason = {
  factor: 'face'
  score: number
  status: FaceStatus
  similarity?: number
  which?: 'child' | 'parent'
  why?: UnclearWhy
  text_en: string
  text_ur: string
}

const WHICH = {
  child: { en: "the child's photo", ur: 'بچے کی تصویر' },
  parent: { en: "the family's photo", ur: 'گھر والوں کی تصویر' },
} as const

const WHY: Record<UnclearWhy, { en: string; ur: string }> = {
  no_face: { en: 'has no visible face', ur: 'میں چہرہ نظر نہیں آتا' },
  several_faces: { en: 'shows more than one face', ur: 'میں ایک سے زیادہ چہرے ہیں' },
  too_small: { en: 'shows the face too small or too far away', ur: 'میں چہرہ بہت چھوٹا یا دور ہے' },
  blurry: { en: 'is blurry', ur: 'دھندلی ہے' },
  too_dark: { en: 'is too dark', ur: 'بہت اندھیری ہے' },
  too_bright: { en: 'is too bright', ur: 'بہت زیادہ روشن ہے' },
  turned_away: { en: 'shows the face turned away', ur: 'میں چہرہ مڑا ہوا ہے' },
  not_clear: { en: "isn't clear enough", ur: 'واضح نہیں ہے' },
}

export type FaceOutcome =
  | { status: 'checked'; similarity: number; under4?: boolean }
  | { status: 'unclear'; which: 'child' | 'parent'; why: UnclearWhy }
  | { status: 'no_photo'; which: 'child' | 'parent' }
  | { status: 'error' }

/** Builds the bilingual reason line the finder / staff read. */
export function faceReason(o: FaceOutcome): FaceReason {
  if (o.status === 'checked') {
    const pct = Math.round(o.similarity)
    const band = faceBand(o.similarity)
    const young = o.under4
      ? { en: ' Less reliable for children under 4.', ur: ' چار سال سے کم عمر بچوں میں کم قابلِ اعتماد ہے۔' }
      : { en: '', ur: '' }
    const text = {
      alike: { en: `Face check: the faces look alike (${pct}%). This is only a hint; check yourself.`, ur: `چہرے کی جانچ: دونوں چہرے ملتے جلتے ہیں (${pct}٪)۔ یہ صرف اشارہ ہے، خود دیکھیں۔` },
      some: { en: `Face check: some resemblance (${pct}%). Look carefully.`, ur: `چہرے کی جانچ: کچھ مشابہت ہے (${pct}٪)۔ غور سے دیکھیں۔` },
      different: { en: `Face check: the faces don't look alike (${pct}%). Look very carefully.`, ur: `چہرے کی جانچ: چہرے نہیں ملتے (${pct}٪)۔ بہت غور سے دیکھیں۔` },
    }[band]
    return { factor: 'face', score: Math.round(o.similarity) / 100, status: band, similarity: pct, text_en: text.en + young.en, text_ur: text.ur + young.ur }
  }
  if (o.status === 'unclear') {
    return {
      factor: 'face',
      score: 0,
      status: 'unclear',
      which: o.which,
      why: o.why,
      text_en: `Face check skipped: ${WHICH[o.which].en} ${WHY[o.why].en}.`,
      text_ur: `چہرہ نہیں جانچا گیا: ${WHICH[o.which].ur} ${WHY[o.why].ur}۔`,
    }
  }
  if (o.status === 'no_photo') {
    return {
      factor: 'face',
      score: 0,
      status: 'no_photo',
      which: o.which,
      text_en: `Face check skipped: there is no ${o.which === 'child' ? "child's" : 'family'} photo to compare.`,
      text_ur: `چہرہ نہیں جانچا گیا: موازنے کے لیے ${WHICH[o.which].ur} موجود نہیں۔`,
    }
  }
  return { factor: 'face', score: 0, status: 'error', text_en: 'Face check is unavailable right now.', text_ur: 'چہرے کی جانچ ابھی دستیاب نہیں۔' }
}

/** Keeps an existing face result when the other factors are re-scored. */
export function keepFaceReason<T extends { factor: string }>(fresh: T[], previous: unknown): Array<T | FaceReason> {
  const old = Array.isArray(previous) ? (previous as Array<{ factor?: string }>).find((r) => r?.factor === 'face') : undefined
  return old ? [...fresh.filter((r) => r.factor !== 'face'), old as FaceReason] : fresh
}
