import { describe, expect, it } from 'vitest'
import { judgeTranscript, usableTypedText } from '../supabase/functions/_shared/speech.ts'
import { hasChildFacts, normalizeExtract } from '../supabase/functions/_shared/extract-fallback.ts'

const speech = (text: string) => ({ text, duration: 6, segments: [{ text, no_speech_prob: 0.05, avg_logprob: -0.3, compression_ratio: 1.2 }] })

describe('judgeTranscript: real speech passes', () => {
  it('Roman Urdu description', () => {
    const r = judgeTranscript(speech('Bacha mila hai, naam Hamza batata hai, neeli kameez, abu ka naam Bilal'))
    expect(r.reject).toBeNull()
    expect(r.text).toContain('Hamza')
  })
  it('Urdu script description', () => {
    expect(judgeTranscript(speech('ایک بچی ملی ہے، نام زینب بتا رہی ہے، گلابی فراک')).reject).toBeNull()
  })
  it('keeps only the spoken segments', () => {
    const r = judgeTranscript({
      text: 'naam Ali hai. Thank you.',
      duration: 8,
      segments: [
        { text: 'naam Ali hai.', no_speech_prob: 0.1, avg_logprob: -0.4 },
        { text: 'Thank you.', no_speech_prob: 0.9, avg_logprob: -1.4 },
      ],
    })
    expect(r).toEqual({ text: 'naam Ali hai.', reject: null })
  })
})

describe('judgeTranscript: silence and invented words are rejected', () => {
  it('empty text', () => expect(judgeTranscript({ text: '  ', duration: 4 }).reject).toBe('no_speech'))
  it('too short', () => expect(judgeTranscript({ text: 'Ali', duration: 0.5 }).reject).toBe('too_short'))
  it('every segment is silence', () => {
    expect(judgeTranscript({ text: 'Bacha mila hai.', duration: 5, segments: [{ text: 'Bacha mila hai.', no_speech_prob: 0.95, avg_logprob: -1.6 }] }).reject).toBe('no_speech')
  })
  it('subtitle phrases', () => {
    expect(judgeTranscript(speech('Thanks for watching!')).reject).toBe('hallucination')
    expect(judgeTranscript(speech('Please subscribe to my channel')).reject).toBe('hallucination')
    expect(judgeTranscript(speech('Subtitles by the Amara.org community')).reject).toBe('hallucination')
  })
  it('filler only', () => {
    expect(judgeTranscript(speech('Thank you.')).reject).toBe('no_speech')
    expect(judgeTranscript(speech('شکریہ')).reject).toBe('no_speech')
    expect(judgeTranscript(speech('...')).reject).toBe('no_speech')
  })
  it('echo of the vocabulary hint', () => {
    expect(judgeTranscript(speech('Urdu, Punjabi, Saraiki. bacha, bachi, abu, ammi')).reject).toBe('hallucination')
  })
  it('the OLD story-like hint echoed back is caught when it is the prompt', () => {
    const old = 'Bacha mila hai. Naam Ali, abu ka naam Raza. Laal shirt, kali shalwar.'
    expect(judgeTranscript(speech(old), old).reject).toBe('hallucination')
  })
  it('one word looping', () => {
    expect(judgeTranscript(speech('Ali Ali Ali Ali Ali Ali Ali')).reject).toBe('hallucination')
  })
  it('repetition loop flagged by Whisper', () => {
    expect(judgeTranscript({ text: 'ha ha ha', duration: 5, segments: [{ text: 'ha ha ha', no_speech_prob: 0.2, avg_logprob: -0.5, compression_ratio: 3.1 }] }).reject).toBe('no_speech')
  })
})

describe('usableTypedText', () => {
  it('needs real letters', () => {
    expect(usableTypedText('12 !!')).toBeNull()
    expect(usableTypedText('ab')).toBeNull()
    expect(usableTypedText(42)).toBeNull()
    expect(usableTypedText('  bachi mili hai  ')).toBe('bachi mili hai')
  })
})

describe('summaries need facts', () => {
  it('an LLM summary with no facts is dropped', () => {
    const e = normalizeExtract({ child_name: null, gender: null, clothing: {}, summary_en: 'A child was found.', summary_ur: 'ایک بچہ ملا۔' })!
    expect(hasChildFacts(e)).toBe(false)
    expect(e.summary_en).toBeNull()
    expect(e.summary_ur).toBeNull()
  })
  it('a summary with facts is kept', () => {
    const e = normalizeExtract({ child_name: 'Hamza', clothing: {}, summary_en: 'Boy named Hamza.' })!
    expect(e.summary_en).toBe('Boy named Hamza.')
  })
})
