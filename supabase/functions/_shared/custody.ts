// Custody rules (R10 + R13, added 2026-11-12). Pure TypeScript, no imports: runs in Deno and Vitest.
//
// R10: a found child normally goes to a safe point, and staff verify the handover.
// R13 (direct handover, faster reunions): a BOY aged 4 or older may stay with the finder for up to
//      1 hour while Wapsi looks for the family. If the family is found, the finder runs the same
//      verification checklist and the case is reunited. If 1 hour passes, police take over and the
//      finder has 1 more hour to bring him to a safe point. Girls (R4) and under-4s (R11) always go
//      to a safe point first.

export type CustodyCase = {
  gender: 'male' | 'female' | null
  age_est: number | null
  flags: string[] | null
  safe_point_id: string | null
}

export const WITH_FINDER = 'with_finder' // R13: the finder is keeping the child for now
export const IN_CUSTODY = 'in_custody' // safe point staff accepted the child

/** Only a boy whose age is known and 4 or more may stay with the finder. */
export function directEligible(c: CustodyCase): boolean {
  return c.gender === 'male' && c.age_est !== null && c.age_est >= 4 && !(c.flags ?? []).includes('under_4')
}

/** The child is currently with the finder under R13 (no safe point involved). */
export function isDirect(c: CustodyCase): boolean {
  return (c.flags ?? []).includes(WITH_FINDER) && !c.safe_point_id && directEligible(c)
}

export function hasCustody(c: Pick<CustodyCase, 'flags'>): boolean {
  return (c.flags ?? []).includes(IN_CUSTODY)
}

/** Returns flags with `add` added and `remove` removed (no duplicates). */
export function withFlags(flags: string[] | null, add: string[] = [], remove: string[] = []): string[] {
  const s = new Set(flags ?? [])
  for (const f of remove) s.delete(f)
  for (const f of add) s.add(f)
  return [...s]
}
