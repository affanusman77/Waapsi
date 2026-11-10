// Re-runs extraction on a case, optionally with the answer to a guided question (text or a
// voice note). Synchronous so the case card can show the new chips straight away.
import { adminClient, getCaller, handle, HttpError, json } from '../_shared/http.ts'
import { assertCaseActor, loadCase } from '../_shared/access.ts'
import { processCase } from '../_shared/pipeline.ts'

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const c = await loadCase(admin, body.case_id)
    assertCaseActor(caller, c)

    const answerVoice = typeof body.answer_voice_path === 'string' ? body.answer_voice_path : undefined
    if (answerVoice && !answerVoice.startsWith(`${caller.id}/`)) throw new HttpError(400, 'bad_media_path')
    const answerText = typeof body.answer_text === 'string' ? body.answer_text.slice(0, 1000) : undefined

    const res = await processCase(admin, c.id, { extraText: answerText, extraVoicePath: answerVoice })
    return json({ ai_status: res.status, extract: res.extract })
  }),
)
