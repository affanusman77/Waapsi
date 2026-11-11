// Transcribes one of the caller's own voice notes, and with `summarize: true` also writes the short
// English + Urdu summary (the "Summarise with AI" button under the voice recorder).
// The case pipeline does the same work itself after a case is filed; this endpoint is a preview
// for the person speaking. It never creates or changes a case. Fails open: no AI key → ai_status 'off'.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { activeModel, aiConfigured, chatJSON, transcribe } from '../_shared/ai.ts'
import { audit } from '../_shared/audit.ts'
import { normalizeExtract } from '../_shared/extract-fallback.ts'
import { EXTRACT_SYSTEM, extractUser } from '../_shared/prompts.ts'

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const path = typeof body.voice_path === 'string' ? body.voice_path : null
    if (!path || !path.startsWith(`${caller.id}/`)) throw new HttpError(400, 'bad_media_path')
    const summarize = body.summarize === true
    const kind = body.kind === 'lost' ? 'lost' : 'found'
    if (!aiConfigured()) return json({ text: null, summary_en: null, summary_ur: null, ai_status: 'off' })

    let text: string
    try {
      const { data: blob, error } = await admin.storage.from('voice-notes').download(path)
      if (error || !blob) throw error ?? new Error('download failed')
      const r = await transcribe(blob, path.split('/').pop() ?? 'voice.webm')
      text = r.text
      await audit(admin, { action: 'ai.transcribed', actor: { type: 'ai' }, payload: { language: r.language, chars: r.text.length, preview: true } })
      if (!summarize) return json({ text, language: r.language, ai_status: 'ok' })
    } catch (e) {
      await audit(admin, { action: 'ai.transcribe_failed', actor: { type: 'ai' }, payload: { error: String(e).slice(0, 200) } })
      return json({ text: null, summary_en: null, summary_ur: null, ai_status: 'failed' })
    }

    if (!text) return json({ text: '', summary_en: null, summary_ur: null, ai_status: 'empty' })
    try {
      const e = normalizeExtract(await chatJSON(EXTRACT_SYSTEM, extractUser(kind, text)))
      await audit(admin, { action: 'ai.summarized', actor: { type: 'ai' }, payload: { kind, ok: !!e?.summary_en, model: activeModel() } })
      return json({ text, summary_en: e?.summary_en ?? null, summary_ur: e?.summary_ur ?? null, ai_status: e?.summary_en ? 'ok' : 'partial' })
    } catch (err) {
      await audit(admin, { action: 'ai.summarize_failed', actor: { type: 'ai' }, payload: { error: String(err).slice(0, 200) } })
      return json({ text, summary_en: null, summary_ur: null, ai_status: 'partial' })
    }
  }),
)
