import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Clothing } from './useLiveCase'

export type Reason = {
  factor: string
  score: number
  text_en: string
  text_ur: string
  /** Only on the `face` reason: alike | some | different | unclear | no_photo | error */
  status?: string
}

export type FinderMatch = {
  match_id: string
  found_case_id: string
  lost_case_id: string
  match_status: 'suggested' | 'finder_confirmed' | 'reunited' | 'blocked'
  score: number
  reasons: Reason[]
  via: 'ai' | 'wrist_number'
  lost_kind: 'lost' | 'checkin'
  lost_child_name: string | null
  lost_father_name: string | null
  lost_age_est: number | null
  lost_gender: 'male' | 'female' | null
  lost_clothing: Clothing | null
  lost_has_photo: boolean
  under_4: boolean
}

export type ParentMatch = {
  match_id: string
  lost_case_id: string
  match_status: 'suggested' | 'finder_confirmed' | 'reunited' | 'blocked'
  safe_point_name_en: string | null
  safe_point_name_ur: string | null
  safe_point_lat: number | null
  safe_point_lng: number | null
  found_status: string
  reunited_at: string | null
  found_at: string
}

/**
 * Role views (R2). Views don't emit Realtime events, so we reload whenever a case this user can
 * see changes (a match always moves the user's own case, or a case at the staff's safe point).
 */
function useView<T>(view: 'finder_match_view' | 'parent_match_view', column: string, ids: string[]) {
  const [rows, setRows] = useState<T[]>([])
  const key = ids.join(',')

  const load = useCallback(async () => {
    if (!key) return setRows([])
    const { data } = await supabase.from(view).select('*').in(column, key.split(',')).order('created_at', { ascending: false })
    setRows((data as T[]) ?? [])
  }, [view, column, key])

  useEffect(() => {
    void load()
    if (!key) return
    const ch = supabase
      .channel(`${view}-${key.slice(0, 40)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cases' }, () => void load())
      // The face check lands on the match row a moment after it is suggested.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [load, key, view])

  return { rows, reload: load }
}

export const useFinderMatches = (foundCaseIds: string[]) => useView<FinderMatch>('finder_match_view', 'found_case_id', foundCaseIds)
export const useParentMatches = (lostCaseIds: string[]) => useView<ParentMatch>('parent_match_view', 'lost_case_id', lostCaseIds)
