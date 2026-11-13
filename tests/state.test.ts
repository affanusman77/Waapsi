import { describe, expect, it, vi } from 'vitest'
import {
  InvalidTransitionError,
  canTransition,
  nextState,
  policeStatusFor,
  transition,
  type Actor,
  type CaseEvent,
  type CaseKind,
  type CaseStatus,
  type TransitionStore,
} from '../supabase/functions/_shared/state.ts'

const human: Actor = { type: 'human', id: 'u1' }
const system: Actor = { type: 'system' }
const ai: Actor = { type: 'ai' }

describe('allowed transitions', () => {
  const cases: Array<[CaseKind, CaseStatus, CaseEvent, Actor, CaseStatus]> = [
    ['found', 'reported', 'safe_point_chosen', human, 'awaiting_safe_point'],
    ['found', 'awaiting_safe_point', 'safe_point_accepted', human, 'at_safe_point'],
    ['found', 'reported', 'safe_point_accepted', human, 'at_safe_point'],
    ['found', 'awaiting_safe_point', 'escalate', system, 'escalated_police'],
    ['found', 'at_safe_point', 'match_suggested', ai, 'matched'],
    ['found', 'matched', 'finder_confirmed', human, 'finder_confirmed'],
    ['found', 'matched', 'finder_rejected', human, 'at_safe_point'],
    ['found', 'finder_confirmed', 'verification_started', human, 'verifying'],
    ['found', 'verifying', 'handover_verified', human, 'reunited'],
    ['found', 'verifying', 'handover_failed', human, 'handover_blocked'],
    ['found', 'reported', 'escalate', system, 'escalated_police'],
    ['found', 'at_safe_point', 'escalate', system, 'escalated_police'],
    // after a police takeover the child can still be brought to / accepted at a safe point
    ['found', 'escalated_police', 'safe_point_chosen', human, 'awaiting_safe_point'],
    ['found', 'escalated_police', 'safe_point_accepted', human, 'at_safe_point'],
    // R13: a boy 4+ staying with the finder can be matched (custody rules enforced in the pipeline)
    ['found', 'reported', 'keep_with_finder', human, 'reported'],
    ['found', 'reported', 'match_suggested', ai, 'matched'],
    ['found', 'escalated_police', 'match_suggested', system, 'matched'],
    ['found', 'escalated_police', 'close_no_match', human, 'closed_no_match'],
    ['lost', 'reported', 'match_suggested', ai, 'matched'],
    ['lost', 'matched', 'finder_rejected', human, 'reported'],
    ['lost', 'matched', 'finder_confirmed', human, 'finder_confirmed'],
    ['lost', 'verifying', 'handover_verified', human, 'reunited'],
    ['lost', 'reported', 'escalate', system, 'escalated_police'],
    ['checkin', 'reported', 'expire', system, 'expired'],
    ['checkin', 'reported', 'match_suggested', ai, 'matched'],
    ['checkin', 'verifying', 'handover_failed', human, 'handover_blocked'],
    ['found', 'matched', 'match_withdrawn', system, 'at_safe_point'],
    ['checkin', 'matched', 'match_withdrawn', system, 'reported'],
  ]
  it.each(cases)('%s: %s --%s--> %s', (kind, from, event, actor, to) => {
    expect(nextState(kind, from, event, actor).status).toBe(to)
  })

  it('R13: a direct (with-finder) rejection goes back to reported, a safe point one to at_safe_point', () => {
    expect(nextState('found', 'matched', 'finder_rejected', human, { direct: true }).status).toBe('reported')
    expect(nextState('found', 'matched', 'finder_rejected', human, { direct: false }).status).toBe('at_safe_point')
    expect(nextState('found', 'matched', 'match_withdrawn', system, { direct: true }).status).toBe('reported')
  })

  it('a check-in converts to a lost report, keeping status reported', () => {
    expect(nextState('checkin', 'reported', 'convert_to_lost', human)).toEqual({ kind: 'lost', status: 'reported' })
  })
})

describe('forbidden transitions throw', () => {
  const forbidden: Array<[CaseKind, CaseStatus, CaseEvent, Actor]> = [
    ['found', 'matched', 'handover_verified', human], // matched -> reunited directly (R3)
    ['found', 'matched', 'verification_started', human], // skipping finder confirmation
    ['found', 'verifying', 'escalate', system], // a handover under way is never interrupted
    ['found', 'matched', 'escalate', system], // nor a match waiting for the finder
    ['lost', 'finder_confirmed', 'escalate', system],
    ['lost', 'reported', 'keep_with_finder', human], // only found children
    ['found', 'awaiting_safe_point', 'match_suggested', ai], // safe point hasn't accepted yet (R10)
    ['found', 'awaiting_safe_point', 'safe_point_accepted', ai], // only staff accept custody
    ['lost', 'reported', 'safe_point_accepted', human], // lost reports have no child to accept
    ['found', 'finder_confirmed', 'handover_verified', human], // skipping verifying
    ['found', 'reunited', 'escalate', system], // final
    ['found', 'handover_blocked', 'match_suggested', ai], // final
    ['found', 'reported', 'expire', system], // only check-ins expire
    ['lost', 'reported', 'safe_point_chosen', human], // only found cases go to safe points
    ['checkin', 'reported', 'escalate', system], // check-ins don't escalate
    ['checkin', 'expired', 'convert_to_lost', human], // final
    ['lost', 'reported', 'close_no_match', human], // only escalated cases can be closed
    ['lost', 'matched', 'match_withdrawn', human], // withdrawal is a system clean-up, not a human decision
    ['found', 'finder_confirmed', 'match_withdrawn', system], // a confirmed match is never withdrawn silently
  ]
  it.each(forbidden)('%s: %s --%s--> throws', (kind, from, event, actor) => {
    expect(() => nextState(kind, from, event, actor)).toThrow(InvalidTransitionError)
  })

  it('AI can never confirm, verify or block (R3: humans decide)', () => {
    expect(canTransition('found', 'matched', 'finder_confirmed', ai)).toBe(false)
    expect(canTransition('found', 'verifying', 'handover_verified', ai)).toBe(false)
    expect(canTransition('found', 'verifying', 'handover_failed', ai)).toBe(false)
  })

  it('a human cannot trigger escalation or expiry (system only)', () => {
    expect(canTransition('found', 'reported', 'escalate', human)).toBe(false)
    expect(canTransition('checkin', 'reported', 'expire', human)).toBe(false)
  })
})

describe('police status follows the case (R5)', () => {
  it('maps statuses', () => {
    expect(policeStatusFor('at_safe_point')).toBe('In safe custody')
    expect(policeStatusFor('escalated_police')).toBe('Active takeover')
    expect(policeStatusFor('handover_blocked')).toBe('URGENT: verification failed')
    expect(policeStatusFor('reunited')).toBe('Reunited')
    expect(policeStatusFor('matched')).toBeNull()
  })
})

describe('transition()', () => {
  function fakeStore(updateOk = true): TransitionStore {
    return {
      updateCase: vi.fn(async () => updateOk),
      setPoliceStatus: vi.fn(async () => {}),
      audit: vi.fn(async () => {}),
    }
  }

  it('updates the case, the police record and the audit log', async () => {
    const store = fakeStore()
    const next = await transition(store, { id: 'c1', kind: 'found', status: 'verifying' }, 'handover_verified', human)
    expect(next.status).toBe('reunited')
    expect(store.updateCase).toHaveBeenCalledWith('c1', 'verifying', { kind: 'found', status: 'reunited' }, {})
    expect(store.setPoliceStatus).toHaveBeenCalledWith('c1', 'Reunited')
    expect(store.audit).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'c1', action: 'case.handover_verified', actor: human }),
    )
  })

  it('writes nothing when the move is invalid', async () => {
    const store = fakeStore()
    await expect(
      transition(store, { id: 'c1', kind: 'found', status: 'matched' }, 'handover_verified', human),
    ).rejects.toThrow(InvalidTransitionError)
    expect(store.updateCase).not.toHaveBeenCalled()
    expect(store.audit).not.toHaveBeenCalled()
  })

  it('fails when the case changed underneath us (optimistic lock)', async () => {
    const store = fakeStore(false)
    await expect(
      transition(store, { id: 'c1', kind: 'found', status: 'at_safe_point' }, 'match_suggested', ai),
    ).rejects.toThrow(/concurrently/)
    expect(store.setPoliceStatus).not.toHaveBeenCalled()
  })
})
