// Case pipeline: transcribe -> extract -> merge -> match. Runs in the background after a case is
// created (EdgeRuntime.waitUntil) and again when a finder answers a guided question or edits a field.
// Every step is audited (R7) and fails open (R6): a broken AI call never loses or blocks a report.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { aiConfigured, chatJSON, transcribe } from './ai.ts'
import { audit } from './audit.ts'
import { keywordExtract, normalizeExtract, type Extract } from './extract-fallback.ts'
import { normName, scoreMatch, SUGGEST_THRESHOLD, type MatchableCase } from './matching.ts'
import { EXTRACT_SYSTEM, extractUser } from './prompts.ts'
import { canTransition, transition, type CaseKind, type CaseStatus } from './state.ts'
import { supabaseStore } from './store.ts'
import { checkFaces } from './face-check.ts'
import { keepFaceReason } from './face.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

/** Keeps the function alive until `p` settles, after the HTTP response is sent. */
export function inBackground(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error('[background]', e))
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(guarded)
}

type CaseFull = {
  id: string
  kind: CaseKind
  status: CaseStatus
  reporter_id: string | null
  child_name: string | null
  father_name: string | null
  age_est: number | null
  gender: 'male' | 'female' | null
  clothing: Extract['clothing'] | null
  languages: string[] | null
  transcript: string | null
  voice_path: string | null
  ai_extract: Record<string, unknown> | null
  ai_status: string
  lat: number | null
  lng: number | null
  seen_at: string
  safe_point_id: string | null
  flags: string[]
}

const MERGEABLE = ['child_name', 'father_name', 'age_est', 'gender', 'clothing', 'languages'] as const

async function loadCase(admin: SupabaseClient, id: string): Promise<CaseFull> {
  const { data, error } = await admin.from('cases').select('*').eq('id', id).single()
  if (error) throw error
  return data as CaseFull
}

/**
 * Runs AI on a case. `extraText` (e.g. a guided-question answer) is appended to the transcript.
 * Human-entered fields (ai_extract.human_fields) are never overwritten.
 */
export async function processCase(
  admin: SupabaseClient,
  caseId: string,
  opts: { extraText?: string; extraVoicePath?: string } = {},
): Promise<{ status: string; extract: Extract }> {
  const c = await loadCase(admin, caseId)
  const meta = (c.ai_extract ?? {}) as { human_fields?: string[]; voice_done?: string[] }
  const human = new Set(meta.human_fields ?? [])
  const voiceDone = new Set(meta.voice_done ?? [])
  let transcript = c.transcript ?? ''
  let aiStatus: 'ok' | 'fallback' | 'failed' = aiConfigured() ? 'ok' : 'fallback'

  // 1. Transcribe any voice notes not yet transcribed.
  for (const path of [c.voice_path, opts.extraVoicePath].filter((p): p is string => !!p && !voiceDone.has(p))) {
    if (!aiConfigured()) break
    try {
      const { data: blob, error } = await admin.storage.from('voice-notes').download(path)
      if (error || !blob) throw error ?? new Error('download failed')
      const { text, language, rejected } = await transcribe(blob, path.split('/').pop() ?? 'voice.webm')
      if (text) transcript = [transcript, text].filter(Boolean).join('\n')
      voiceDone.add(path)
      await audit(admin, { action: rejected ? 'ai.voice_rejected' : 'ai.transcribed', actor: { type: 'ai' }, caseId, payload: { language, chars: text.length, rejected } })
    } catch (e) {
      aiStatus = 'failed'
      await audit(admin, { action: 'ai.transcribe_failed', actor: { type: 'ai' }, caseId, payload: { error: String(e).slice(0, 200) } })
    }
  }
  if (opts.extraText?.trim()) transcript = [transcript, opts.extraText.trim()].filter(Boolean).join('\n')

  // 2. Extract (LLM -> validate -> retry once -> keyword fallback).
  let extract: Extract | null = null
  if (transcript && aiConfigured()) {
    for (let attempt = 0; attempt < 2 && !extract; attempt++) {
      try {
        extract = normalizeExtract(await chatJSON(EXTRACT_SYSTEM, extractUser(c.kind, transcript)))
      } catch (e) {
        if (attempt === 1) await audit(admin, { action: 'ai.extract_failed', actor: { type: 'ai' }, caseId, payload: { error: String(e).slice(0, 200) } })
      }
    }
  }
  if (!extract) {
    extract = keywordExtract(transcript)
    if (aiConfigured()) aiStatus = 'fallback'
  }

  // 3. Merge: AI fills gaps and refreshes its own earlier guesses; humans always win.
  const patch: Record<string, unknown> = {}
  for (const f of MERGEABLE) {
    if (human.has(f)) continue
    const v = extract[f as keyof Extract]
    const empty = v === null || v === undefined || (Array.isArray(v) && !v.length) || (f === 'clothing' && !Object.values(v as object).some((x) => x && (!Array.isArray(x) || x.length)))
    if (!empty) patch[f] = v
  }
  // R4 safety: AI may not turn a child into a girl while they're headed to / at a point without women staff.
  if (patch.gender === 'female' && c.gender !== 'female' && c.safe_point_id) {
    const { data: sp } = await admin.from('safe_points').select('women_staff').eq('id', c.safe_point_id).single()
    if (sp && !sp.women_staff) {
      delete patch.gender
      await admin.from('cases').update({ flags: [...new Set([...(c.flags ?? []), 'girl_at_non_behan_point'])] }).eq('id', caseId)
    }
  }
  if ('child_name' in patch) patch.child_name_norm = normName(patch.child_name as string)
  if ('father_name' in patch) patch.father_name_norm = normName(patch.father_name as string)

  await admin
    .from('cases')
    .update({
      ...patch,
      transcript: transcript || null,
      ai_status: transcript ? aiStatus : 'fallback',
      ai_extract: { ...extract, human_fields: [...human], voice_done: [...voiceDone], source: aiStatus === 'ok' ? 'ai' : 'keywords' },
    })
    .eq('id', caseId)
  await audit(admin, {
    action: aiStatus === 'ok' ? 'ai.extracted' : 'ai.fallback_extracted',
    actor: { type: aiStatus === 'ok' ? 'ai' : 'system' },
    caseId,
    payload: { fields: Object.keys(patch), missing: extract.missing_fields },
  })

  // 4. Match.
  await runMatching(admin, caseId)
  return { status: aiStatus, extract }
}

const OPEN_FOUND: CaseStatus[] = ['reported', 'awaiting_safe_point', 'at_safe_point', 'matched', 'escalated_police']
const OPEN_LOST: CaseStatus[] = ['reported', 'matched', 'escalated_police']

/**
 * Scores a case against the open cases of the opposite side, upserts suggestions (score ≥ 0.6),
 * and moves both cases to `matched` where the state machine allows it. A found child is only
 * matched once a safe point has accepted them (R10); earlier suggestions wait and are applied
 * when the safe point accepts (case-transition calls this again).
 */
export async function runMatching(admin: SupabaseClient, caseId: string): Promise<number> {
  const c = await loadCase(admin, caseId)
  const isFound = c.kind === 'found'
  if (!isFound && !OPEN_LOST.includes(c.status)) return 0
  if (isFound && !OPEN_FOUND.includes(c.status)) return 0

  const since = new Date(Date.parse(c.seen_at) - 12 * 3600_000).toISOString()
  const until = new Date(Date.parse(c.seen_at) + 12 * 3600_000).toISOString()
  const { data: others } = await admin
    .from('cases')
    .select('*')
    .in('kind', isFound ? ['lost', 'checkin'] : ['found'])
    .in('status', isFound ? OPEN_LOST : OPEN_FOUND)
    .gte('seen_at', since)
    .lte('seen_at', until)
    .limit(500)

  let suggested = 0
  for (const o of (others ?? []) as CaseFull[]) {
    const [f, l] = isFound ? [c, o] : [o, c]
    const r = scoreMatch(f as MatchableCase, l as MatchableCase)
    if (!r || r.score < SUGGEST_THRESHOLD) continue

    const { data: existing } = await admin
      .from('matches')
      .select('id, status, score, reasons')
      .eq('found_case_id', f.id)
      .eq('lost_case_id', l.id)
      .maybeSingle()
    if (existing && existing.status !== 'suggested') continue // humans already decided

    let matchId = existing?.id as string | undefined
    if (!existing) {
      const { data: ins, error } = await admin
        .from('matches')
        .insert({ found_case_id: f.id, lost_case_id: l.id, score: r.score, reasons: r.reasons, via: 'ai' })
        .select('id')
        .single()
      if (error) continue // lost a race with a parallel run: fine
      matchId = ins.id
      await audit(admin, { action: 'match.suggested', actor: { type: 'ai' }, caseId: f.id, matchId, payload: { score: r.score, strong: r.strong, lost_case_id: l.id } })
      // Face check runs only now that a match is suggested, and before the finder is told, so the
      // hint is there when they look. Bounded by AWS timeouts; failures just show "unavailable".
      await checkFaces(admin, ins.id)
    } else if (Math.abs(Number(existing.score) - r.score) > 0.001) {
      await admin.from('matches').update({ score: r.score, reasons: keepFaceReason(r.reasons, existing.reasons) }).eq('id', existing.id)
    }
    suggested++
    await applyMatchTransitions(admin, f.id, l.id, matchId!)
  }
  return suggested
}

/** Moves both sides of a suggested match to `matched` if (and only if) the state machine allows it. */
export async function applyMatchTransitions(admin: SupabaseClient, foundId: string, lostId: string, matchId: string) {
  const store = supabaseStore(admin)
  for (const id of [foundId, lostId]) {
    const { data: row } = await admin.from('cases').select('id, kind, status').eq('id', id).single()
    if (row && canTransition(row.kind, row.status, 'match_suggested', { type: 'ai' })) {
      await transition(store, row, 'match_suggested', { type: 'ai' }, { match_id: matchId }).catch(() => {})
    }
  }
}
