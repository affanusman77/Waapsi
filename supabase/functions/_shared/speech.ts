// Decides whether a Whisper transcript is real speech. Whisper "hears" words in silence: it echoes
// its prompt, or writes stock phrases from video subtitles ("Thanks for watching"). A silent voice
// note must never turn into a fake report, so anything doubtful is rejected here.
// Pure TypeScript, no imports: runs in Deno and Vitest.

/** Vocabulary hint for Whisper. A word list, NOT a story: an echoed sentence would read like a real report. */
export const STT_PROMPT = 'Urdu, Punjabi, Saraiki. bacha, bachi, abu, ammi, shalwar, kameez, frock.'

export type WhisperSegment = { text?: string; no_speech_prob?: number; avg_logprob?: number; compression_ratio?: number }
export type WhisperVerbose = { text?: string; duration?: number; segments?: WhisperSegment[] }
export type SpeechReject = 'no_speech' | 'too_short' | 'hallucination'

// Phrases Whisper is known to invent on silence or noise (it was trained on subtitled video).
const STOCK_PHRASES: RegExp[] = [
  /thanks? (you )?for watching/i,
  /(please )?(like and )?subscribe/i,
  /amara\.org/i,
  /subtitles? (by|from|created)/i,
  /transcri(bed|ption) by/i,
  /www\.|https?:\/\//i,
  /سبسکرائب/,
  /ترجمہ/,
]
// Whole-transcript fillers that carry no information about a child.
const FILLER_ONLY = /^(thank you|thanks|bye|okay|ok|you|hmm+|uh+|um+|music|applause|shukriya|شکریہ|اللہ حافظ|السلام علیکم|جی|ہاں)$/i

const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * Returns the usable text, or a reason to reject it.
 * Segment rule follows Whisper's own: a segment is silence when it is probably not speech
 * (no_speech_prob > 0.6) AND the model wasn't confident (avg_logprob < -1). Repetition loops
 * (compression_ratio > 2.4) are dropped too.
 */
export function judgeTranscript(j: WhisperVerbose, prompt = STT_PROMPT): { text: string; reject: SpeechReject | null } {
  if (typeof j.duration === 'number' && j.duration < 0.8) return { text: '', reject: 'too_short' }

  let text = String(j.text ?? '').trim()
  if (Array.isArray(j.segments) && j.segments.length) {
    const kept = j.segments.filter((s) => {
      const silent = (s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -1
      const looping = (s.compression_ratio ?? 0) > 2.4
      return !silent && !looping
    })
    if (!kept.length) return { text: '', reject: 'no_speech' }
    text = kept.map((s) => String(s.text ?? '').trim()).filter(Boolean).join(' ').trim()
  }

  const words = tokens(text)
  const letters = (text.match(/\p{L}/gu) ?? []).length
  if (!words.length || letters < 2) return { text: '', reject: 'no_speech' }

  const cleaned = text.replace(/[\s.,!?؟۔…\-"'“”]+/g, ' ').trim()
  if (FILLER_ONLY.test(cleaned)) return { text: '', reject: 'no_speech' }
  if (STOCK_PHRASES.some((r) => r.test(text))) return { text: '', reject: 'hallucination' }

  // Prompt echo: almost every word comes straight from the hint we gave Whisper.
  const hint = new Set(tokens(prompt))
  const fromHint = words.filter((w) => hint.has(w)).length
  if (words.length >= 2 && fromHint / words.length >= 0.7) return { text: '', reject: 'hallucination' }

  // One word repeated over and over ("Ali Ali Ali Ali Ali Ali").
  if (words.length >= 6) {
    const counts = new Map<string, number>()
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
    if (Math.max(...counts.values()) / words.length > 0.6) return { text: '', reject: 'hallucination' }
  }

  return { text, reject: null }
}

/** Typed descriptions need at least a couple of real words. */
export function usableTypedText(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim().slice(0, 2000)
  return (t.match(/\p{L}/gu) ?? []).length >= 3 ? t : null
}
