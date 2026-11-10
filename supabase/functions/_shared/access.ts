// Who may act on a case / a match. Used by every function that changes data.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { HttpError, type Profile } from './http.ts'

export type CaseLite = {
  id: string
  kind: 'found' | 'lost' | 'checkin'
  status: string
  reporter_id: string | null
  safe_point_id: string | null
  gender: 'male' | 'female' | null
  flags: string[]
  created_at: string
}

export async function loadCase(admin: SupabaseClient, id: unknown): Promise<CaseLite> {
  if (typeof id !== 'string') throw new HttpError(400, 'case_id_required')
  const { data } = await admin
    .from('cases')
    .select('id, kind, status, reporter_id, safe_point_id, gender, flags, created_at')
    .eq('id', id)
    .maybeSingle()
  if (!data) throw new HttpError(404, 'case_not_found')
  return data as CaseLite
}

export const isStaffAt = (caller: Profile, spId: string | null) =>
  caller.role === 'sp_staff' && !!caller.safe_point_id && caller.safe_point_id === spId

/** Reporter, staff of the case's safe point, or admin. */
export function assertCaseActor(caller: Profile, c: CaseLite) {
  if (c.reporter_id === caller.id || caller.role === 'admin' || isStaffAt(caller, c.safe_point_id)) return
  throw new HttpError(403, 'not_your_case')
}

export type MatchFull = {
  id: string
  status: string
  found: CaseLite
  lost: CaseLite
}

export async function loadMatch(admin: SupabaseClient, id: unknown): Promise<MatchFull> {
  if (typeof id !== 'string') throw new HttpError(400, 'match_id_required')
  const { data: m } = await admin.from('matches').select('id, status, found_case_id, lost_case_id').eq('id', id).maybeSingle()
  if (!m) throw new HttpError(404, 'match_not_found')
  const [found, lost] = await Promise.all([loadCase(admin, m.found_case_id), loadCase(admin, m.lost_case_id)])
  return { id: m.id, status: m.status, found, lost }
}

/**
 * Who confirms a match against the parent's photo (R3): the finder, except for under-4s,
 * where the safe point staff do it (R11). Admin can always act (demo control room).
 */
export function assertCanConfirm(caller: Profile, m: MatchFull) {
  if (caller.role === 'admin') return
  const under4 = m.found.flags?.includes('under_4')
  if (under4) {
    if (isStaffAt(caller, m.found.safe_point_id)) return
    throw new HttpError(403, 'under4_staff_confirms')
  }
  if (m.found.reporter_id === caller.id || isStaffAt(caller, m.found.safe_point_id)) return
  throw new HttpError(403, 'not_your_case')
}

export function isParty(caller: Profile, m: MatchFull) {
  return (
    caller.role === 'admin' ||
    m.found.reporter_id === caller.id ||
    m.lost.reporter_id === caller.id ||
    isStaffAt(caller, m.found.safe_point_id)
  )
}
