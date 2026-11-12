// Autofill for the report forms. Takes the caller's own voice note and/or typed description,
// transcribes and extracts it, and returns form fields + a short English/Urdu summary so the
// reporter can REVIEW everything before submitting. It never creates or changes a case: the case
// pipeline runs again after submit. Fails open: no AI key or an AI error -> keyword fallback or
// an empty form the person fills in themselves.
//
// ai_status:
//   ok         AI understood and filled fields
//   partial    some fields came from the keyword fallback (LLM failed), or no summary
//   unclear    real speech/text, but nothing about a child in it
//   no_speech  the voice note is silent / too short / Whisper invented the words -> record again
//   empty      nothing to read
//   off        AI not configured and nothing typed
//   failed     transcription failed (network/provider); form stays manual
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { activeModel, aiConfigured, chatJSON, transcribe } from '../_shared/ai.ts'
import { audit } from '../_shared/audit.ts'
import { hasChildFacts, keywordExtract, normalizeExtract, type Extract } from '../_shared/extract-fallback.ts'
import { EXTRACT_SYSTEM, extractUser } from '../_shared/prompts.ts'
import { usableTypedText } from '../_shared/speech.ts'

type Status = 'ok' | 'partial' | 'unclear' | 'no_speech' | 'empty' | 'off' | 'failed'

function fieldsOf(e: Extract | null) {
  return {
    child_name: e?.child_name ?? null,
    father_name: e?.father_name ?? null,
    age_est: e?.age_est ?? null,
    gender: e?.gender ?? null,
    top_color: e?.clothing?.top_color ?? null,
    top_type: e?.clothing?.top_type ?? null,
    bottom_color: e?.clothing?.bottom_color ?? null,
    bottom_type: e?.clothing?.bottom_type ?? null,
    home_area: e?.home_area ?? null,
  }
}

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const path = typeof body.voice_path === 'string' && body.voice_path ? body.voice_path : null
    if (path && !path.startsWith(`${caller.id}/`)) throw new HttpError(400, 'bad_media_path')
    const typed = usableTypedText(body.text)
    const kind = body.kind === 'lost' ? 'lost' : 'found'
    const reply = (ai_status: Status, extra: { text?: string | null; e?: Extract | null; reason?: string | null } = {}) =>
      json({
        ai_status,
        text: extra.text ?? null,
        summary_en: extra.e?.summary_en ?? null,
        summary_ur: extra.e?.summary_ur ?? null,
        fields: fieldsOf(extra.e ?? null),
        reason: extra.reason ?? null,
      })

    if (!path && !typed) return reply('empty')

    // 1. Voice -> text (rejecting silence and invented words).
    let heard = ''
    if (path) {
      if (!aiConfigured()) {
        if (!typed) return reply('off')
      } else {
        try {
          const { data: blob, error } = await admin.storage.from('voice-notes').download(path)
          if (error || !blob) throw error ?? new Error('download failed')
          const r = await transcribe(blob, path.split('/').pop() ?? 'voice.webm')
          await audit(admin, {
            action: r.rejected ? 'ai.voice_rejected' : 'ai.transcribed',
            actor: { type: 'ai' },
            payload: { language: r.language, chars: r.text.length, rejected: r.rejected, preview: true },
          })
          // A voice note with no real speech is sent back to be re-recorded, even if text was typed too.
          if (r.rejected) return reply('no_speech', { reason: r.rejected })
          heard = r.text
        } catch (e) {
          await audit(admin, { action: 'ai.transcribe_failed', actor: { type: 'ai' }, payload: { error: String(e).slice(0, 200) } })
          if (!typed) return reply('failed')
        }
      }
    }

    const all = [heard, typed].filter(Boolean).join('\n')
    if (!all) return reply('empty')

    // 2. Text -> fields (LLM, validated; keyword fallback).
    let e: Extract | null = null
    let status: Status = 'ok'
    if (aiConfigured()) {
      try {
        e = normalizeExtract(await chatJSON(EXTRACT_SYSTEM, extractUser(kind, all)))
      } catch (err) {
        await audit(admin, { action: 'ai.extract_failed', actor: { type: 'ai' }, payload: { error: String(err).slice(0, 200), preview: true } })
      }
    }
    if (!e) {
      e = keywordExtract(all)
      status = 'partial'
    }
    if (!hasChildFacts(e)) status = 'unclear'
    else if (status === 'ok' && !e.summary_en) status = 'partial'

    await audit(admin, { action: 'ai.autofilled', actor: { type: 'ai' }, payload: { kind, status, model: activeModel(), filled: Object.entries(fieldsOf(e)).filter(([, v]) => v !== null).map(([k]) => k) } })
    return reply(status, { text: heard || null, e })
  }),
)
