// One short question for the finder to ask the child, aimed at the most important missing field.
// AI if available; otherwise a static question list (R6).
import { adminClient, getCaller, handle, json } from '../_shared/http.ts'
import { assertCaseActor, loadCase } from '../_shared/access.ts'
import { aiConfigured, chatJSON } from '../_shared/ai.ts'
import { audit } from '../_shared/audit.ts'
import { missingFields } from '../_shared/extract-fallback.ts'
import { QUESTION_SYSTEM, STATIC_QUESTIONS } from '../_shared/prompts.ts'

Deno.serve(
  handle(async (req, body) => {
    const admin = adminClient()
    const caller = await getCaller(req, admin)
    const lite = await loadCase(admin, body.case_id)
    assertCaseActor(caller, lite)

    const { data: c } = await admin
      .from('cases')
      .select('kind, child_name, father_name, age_est, gender, clothing, ai_extract, languages')
      .eq('id', lite.id)
      .single()
    const extract = (c?.ai_extract ?? {}) as { home_area?: string | null }
    const missing = missingFields({
      child_name: c?.child_name ?? null,
      father_name: c?.father_name ?? null,
      home_area: extract.home_area ?? null,
      age_est: c?.age_est ?? null,
      gender: c?.gender ?? null,
      clothing: c?.clothing ?? {},
    })
    const asked = Array.isArray(body.already_asked) ? (body.already_asked as string[]) : []
    const field = missing.find((m) => !asked.includes(m)) ?? 'done'
    const fallback = { field, ...STATIC_QUESTIONS[field] }

    if (field === 'done' || !aiConfigured()) return json({ question: fallback, source: 'static' })
    try {
      const known = { child_name: c?.child_name, father_name: c?.father_name, age_est: c?.age_est, gender: c?.gender, languages: c?.languages }
      const q = (await chatJSON(QUESTION_SYSTEM, `Missing field to ask about: ${field}\nKnown so far (data): ${JSON.stringify(known)}`, { timeoutMs: 8000 })) as Record<string, unknown>
      if (typeof q.ur !== 'string' || typeof q.en !== 'string') throw new Error('bad shape')
      const question = { field, ur: q.ur.slice(0, 140), roman: String(q.roman ?? fallback.roman).slice(0, 140), en: q.en.slice(0, 140) }
      await audit(admin, { action: 'ai.question_suggested', actor: { type: 'ai' }, caseId: lite.id, payload: { field } })
      return json({ question, source: 'ai' })
    } catch {
      return json({ question: fallback, source: 'static' })
    }
  }),
)
