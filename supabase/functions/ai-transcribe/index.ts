// Transcribes one of the caller's own voice notes (e.g. to preview what was heard).
// The case pipeline transcribes case voice notes itself; this is the standalone endpoint.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { aiConfigured, transcribe } from '../_shared/ai.ts'
import { audit } from '../_shared/audit.ts'

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const path = typeof body.voice_path === 'string' ? body.voice_path : null
    if (!path || !path.startsWith(`${caller.id}/`)) throw new HttpError(400, 'bad_media_path')
    if (!aiConfigured()) return json({ text: null, ai_status: 'fallback' })
    try {
      const { data: blob, error } = await admin.storage.from('voice-notes').download(path)
      if (error || !blob) throw error ?? new Error('download failed')
      const r = await transcribe(blob, path.split('/').pop() ?? 'voice.webm')
      await audit(admin, { action: 'ai.transcribed', actor: { type: 'ai' }, payload: { language: r.language, chars: r.text.length } })
      return json({ text: r.text, language: r.language, ai_status: 'ok' })
    } catch (e) {
      await audit(admin, { action: 'ai.transcribe_failed', actor: { type: 'ai' }, payload: { error: String(e).slice(0, 200) } })
      return json({ text: null, ai_status: 'failed' })
    }
  }),
)
