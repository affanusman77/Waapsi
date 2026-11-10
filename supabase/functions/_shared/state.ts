// Case state machine: the single source of truth for status changes (spec section 6).
// Pure TypeScript, no imports, so it runs in Deno edge functions AND in Vitest.
// RULE: no component or function updates `cases.status` directly; everything goes through transition().

export type CaseKind = 'found' | 'lost' | 'checkin'
export type CaseStatus =
  | 'reported'
  | 'awaiting_safe_point' // finder is taking the child to a chosen safe point
  | 'at_safe_point' // safe point staff ACCEPTED custody (R10)
  | 'matched'
  | 'finder_confirmed'
  | 'verifying'
  | 'reunited'
  | 'escalated_police'
  | 'handover_blocked'
  | 'closed_no_match'
  | 'expired'

export type CaseEvent =
  | 'safe_point_chosen' // finder picks a safe point and starts walking
  | 'safe_point_accepted' // safe point staff accept the child into custody (R10)
  | 'match_suggested' // match function found a candidate (AI suggests, R3)
  | 'finder_confirmed' // finder: "Haan, yehi bacha hai"
  | 'finder_rejected' // finder: "Nahi"
  | 'match_withdrawn' // system: the suggestion became moot (the other child/family was confirmed elsewhere)
  | 'verification_started' // staff opens the handover checklist
  | 'handover_verified' // staff: Verify handover
  | 'handover_failed' // staff: Something's wrong
  | 'escalate' // tick: now > escalate_at (R5)
  | 'expire' // tick: check-in older than 48h (R9)
  | 'convert_to_lost' // parent: "Mera bacha gum ho gaya" on a check-in
  | 'close_no_match' // admin closes an escalated case

export type Actor = { type: 'human' | 'ai' | 'system'; id?: string | null }

export const FINAL_STATUSES: ReadonlySet<CaseStatus> = new Set([
  'reunited',
  'handover_blocked',
  'closed_no_match',
  'expired',
])

type Rule = { from: CaseStatus | CaseStatus[]; to: CaseStatus; kinds: CaseKind[]; actors?: Actor['type'][] }

const NON_FINAL_FOUND: CaseStatus[] = [
  'reported',
  'awaiting_safe_point',
  'at_safe_point',
  'matched',
  'finder_confirmed',
  'verifying',
]
const NON_FINAL_LOST: CaseStatus[] = ['reported', 'matched', 'finder_confirmed', 'verifying']

// Note: `match_suggested` on a found case is only allowed once a safe point has ACCEPTED the child:
// the safe point always sits between finder and parent (R10), and staff must be able to verify the handover.
// Role checks (e.g. only sp_staff of that safe point may send safe_point_accepted) live in the edge functions.
const RULES: Record<CaseEvent, Rule[]> = {
  safe_point_chosen: [{ from: 'reported', to: 'awaiting_safe_point', kinds: ['found'], actors: ['human'] }],
  safe_point_accepted: [
    // reported -> at_safe_point covers a child brought straight to the desk.
    { from: ['reported', 'awaiting_safe_point'], to: 'at_safe_point', kinds: ['found'], actors: ['human'] },
  ],
  match_suggested: [
    { from: ['at_safe_point', 'escalated_police'], to: 'matched', kinds: ['found'] },
    { from: ['reported', 'escalated_police'], to: 'matched', kinds: ['lost', 'checkin'] },
  ],
  finder_confirmed: [{ from: 'matched', to: 'finder_confirmed', kinds: ['found', 'lost', 'checkin'], actors: ['human'] }],
  finder_rejected: [
    { from: 'matched', to: 'at_safe_point', kinds: ['found'], actors: ['human'] },
    { from: 'matched', to: 'reported', kinds: ['lost', 'checkin'], actors: ['human'] },
  ],
  match_withdrawn: [
    { from: 'matched', to: 'at_safe_point', kinds: ['found'], actors: ['system'] },
    { from: 'matched', to: 'reported', kinds: ['lost', 'checkin'], actors: ['system'] },
  ],
  verification_started: [{ from: 'finder_confirmed', to: 'verifying', kinds: ['found', 'lost', 'checkin'], actors: ['human'] }],
  // R3: only a human can complete or block a handover.
  handover_verified: [{ from: 'verifying', to: 'reunited', kinds: ['found', 'lost', 'checkin'], actors: ['human'] }],
  handover_failed: [{ from: 'verifying', to: 'handover_blocked', kinds: ['found', 'lost', 'checkin'], actors: ['human'] }],
  escalate: [
    { from: NON_FINAL_FOUND, to: 'escalated_police', kinds: ['found'], actors: ['system'] },
    { from: NON_FINAL_LOST, to: 'escalated_police', kinds: ['lost'], actors: ['system'] },
  ],
  expire: [{ from: 'reported', to: 'expired', kinds: ['checkin'], actors: ['system'] }],
  convert_to_lost: [{ from: 'reported', to: 'reported', kinds: ['checkin'], actors: ['human'] }],
  close_no_match: [{ from: 'escalated_police', to: 'closed_no_match', kinds: ['found', 'lost'], actors: ['human'] }],
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly kind: CaseKind,
    public readonly status: CaseStatus,
    public readonly event: CaseEvent,
    reason = 'not allowed',
  ) {
    super(`Invalid transition: ${kind}/${status} --${event}--> (${reason})`)
    this.name = 'InvalidTransitionError'
  }
}

export type NextState = { kind: CaseKind; status: CaseStatus }

/** Pure: computes the next state or throws InvalidTransitionError. */
export function nextState(kind: CaseKind, status: CaseStatus, event: CaseEvent, actor: Actor): NextState {
  const rule = RULES[event].find((r) => r.kinds.includes(kind) && ([] as CaseStatus[]).concat(r.from).includes(status))
  if (!rule) throw new InvalidTransitionError(kind, status, event)
  if (rule.actors && !rule.actors.includes(actor.type)) {
    throw new InvalidTransitionError(kind, status, event, `actor '${actor.type}' may not do this`)
  }
  return { kind: event === 'convert_to_lost' ? 'lost' : kind, status: rule.to }
}

export function canTransition(kind: CaseKind, status: CaseStatus, event: CaseEvent, actor: Actor): boolean {
  try {
    nextState(kind, status, event, actor)
    return true
  } catch {
    return false
  }
}

/** Police record status that should follow a transition (R5), or null to leave it unchanged. */
export function policeStatusFor(to: CaseStatus): string | null {
  switch (to) {
    case 'at_safe_point':
      return 'In safe custody'
    case 'escalated_police':
      return 'Active takeover'
    case 'handover_blocked':
      return 'URGENT: verification failed'
    case 'reunited':
      return 'Reunited'
    default:
      return null
  }
}

export const INITIAL_POLICE_STATUS = 'Record only'

/** Persistence port. P1 provides the Supabase (service-role) implementation. */
export interface TransitionStore {
  /**
   * Must only update if the row is still in `expected` status (optimistic lock); returns false otherwise.
   * `patch` carries extra columns that change with the move (e.g. safe_point_id on safe_point_chosen).
   */
  updateCase(caseId: string, expected: CaseStatus, next: NextState, patch: Record<string, unknown>): Promise<boolean>
  setPoliceStatus(caseId: string, status: string): Promise<void>
  audit(entry: { caseId: string; actor: Actor; action: string; payload: Record<string, unknown> }): Promise<void>
}

export async function transition(
  store: TransitionStore,
  c: { id: string; kind: CaseKind; status: CaseStatus },
  event: CaseEvent,
  actor: Actor,
  payload: Record<string, unknown> = {},
  patch: Record<string, unknown> = {},
): Promise<NextState> {
  const next = nextState(c.kind, c.status, event, actor)
  const ok = await store.updateCase(c.id, c.status, next, patch)
  if (!ok) throw new InvalidTransitionError(c.kind, c.status, event, 'case changed concurrently')
  const police = policeStatusFor(next.status)
  if (police) await store.setPoliceStatus(c.id, police)
  await store.audit({
    caseId: c.id,
    actor,
    action: `case.${event}`,
    payload: { from: c.status, to: next.status, kind: next.kind, ...payload },
  })
  return next
}
