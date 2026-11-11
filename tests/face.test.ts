import { describe, expect, it } from 'vitest'
import { assessPhoto, faceBand, faceReason, keepFaceReason, type DetectedFace } from '../supabase/functions/_shared/face.ts'

const clear: DetectedFace = {
  BoundingBox: { Width: 0.3, Height: 0.4, Left: 0.3, Top: 0.2 },
  Confidence: 99.8,
  Pose: { Yaw: 5, Pitch: -3, Roll: 1 },
  Quality: { Brightness: 60, Sharpness: 70 },
}
const withFace = (patch: Partial<DetectedFace>): DetectedFace => ({ ...clear, ...patch })

describe('assessPhoto: unclear photos are never compared', () => {
  it('accepts one clear, front-facing face', () => {
    expect(assessPhoto([clear])).toEqual({ ok: true, face: clear })
  })
  it('no face', () => expect(assessPhoto([])).toEqual({ ok: false, why: 'no_face' }))
  it('ignores detections it is not even 50% sure are faces', () => {
    expect(assessPhoto([withFace({ Confidence: 30 })])).toEqual({ ok: false, why: 'no_face' })
  })
  it('two faces of similar size are ambiguous', () => {
    const other = withFace({ BoundingBox: { Width: 0.25, Height: 0.35, Left: 0.6, Top: 0.2 } })
    expect(assessPhoto([clear, other])).toEqual({ ok: false, why: 'several_faces' })
  })
  it('a small background face does not block the main one', () => {
    const tiny = withFace({ BoundingBox: { Width: 0.05, Height: 0.06, Left: 0.9, Top: 0.1 } })
    expect(assessPhoto([tiny, clear]).ok).toBe(true)
  })
  it('too small / far away', () => {
    expect(assessPhoto([withFace({ BoundingBox: { Width: 0.05, Height: 0.07 } })])).toEqual({ ok: false, why: 'too_small' })
  })
  it('blurry, dark, bright, turned away, unsure', () => {
    expect(assessPhoto([withFace({ Quality: { Brightness: 60, Sharpness: 8 } })])).toEqual({ ok: false, why: 'blurry' })
    expect(assessPhoto([withFace({ Quality: { Brightness: 5, Sharpness: 70 } })])).toEqual({ ok: false, why: 'too_dark' })
    expect(assessPhoto([withFace({ Quality: { Brightness: 99, Sharpness: 70 } })])).toEqual({ ok: false, why: 'too_bright' })
    expect(assessPhoto([withFace({ Pose: { Yaw: 70 } })])).toEqual({ ok: false, why: 'turned_away' })
    expect(assessPhoto([withFace({ Pose: { Pitch: -55 } })])).toEqual({ ok: false, why: 'turned_away' })
    expect(assessPhoto([withFace({ Confidence: 80 })])).toEqual({ ok: false, why: 'not_clear' })
  })
})

describe('faceBand + faceReason', () => {
  it('bands at 90 and 75', () => {
    expect(faceBand(95)).toBe('alike')
    expect(faceBand(90)).toBe('alike')
    expect(faceBand(89.9)).toBe('some')
    expect(faceBand(75)).toBe('some')
    expect(faceBand(74.9)).toBe('different')
  })
  it('a checked match says it is only a hint, in both languages', () => {
    const r = faceReason({ status: 'checked', similarity: 93.4 })
    expect(r).toMatchObject({ factor: 'face', status: 'alike', similarity: 93 })
    expect(r.text_en).toContain('93%')
    expect(r.text_en).toContain('only a hint')
    expect(r.text_ur).toContain('93')
  })
  it('adds the under-4 caution', () => {
    expect(faceReason({ status: 'checked', similarity: 80, under4: true }).text_en).toContain('under 4')
  })
  it('says WHICH photo was unclear and WHY', () => {
    const r = faceReason({ status: 'unclear', which: 'parent', why: 'blurry' })
    expect(r).toMatchObject({ status: 'unclear', which: 'parent', why: 'blurry', score: 0 })
    expect(r.text_en).toBe("Face check skipped: the family's photo is blurry.")
    expect(faceReason({ status: 'unclear', which: 'child', why: 'several_faces' }).text_en).toBe(
      "Face check skipped: the child's photo shows more than one face.",
    )
  })
  it('no photo and errors are explained, never silent', () => {
    expect(faceReason({ status: 'no_photo', which: 'parent' }).text_en).toContain('no family photo')
    expect(faceReason({ status: 'error' }).status).toBe('error')
  })
})

describe('keepFaceReason', () => {
  const fresh = [{ factor: 'child_name', score: 0.9, text_en: 'x', text_ur: 'y' }]
  it('keeps the face result when other factors are re-scored', () => {
    const face = faceReason({ status: 'checked', similarity: 91 })
    expect(keepFaceReason(fresh, [{ factor: 'age', score: 1 }, face])).toEqual([...fresh, face])
  })
  it('leaves reasons alone when there was no face result', () => {
    expect(keepFaceReason(fresh, [{ factor: 'age' }])).toEqual(fresh)
    expect(keepFaceReason(fresh, null)).toEqual(fresh)
  })
})
