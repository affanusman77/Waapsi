import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Clothing = { top_color?: string | null; top_type?: string | null; bottom_color?: string | null; bottom_type?: string | null }

export type CaseRow = {
  id: string
  kind: 'found' | 'lost' | 'checkin'
  status: string
  child_name: string | null
  father_name: string | null
  gender: 'male' | 'female' | null
  age_est: number | null
  clothing: Clothing | null
  flags: string[]
  safe_point_id: string | null
  transcript: string | null
  ai_status: 'pending' | 'ok' | 'failed' | 'fallback'
  ai_extract: { summary_en?: string | null; summary_ur?: string | null; missing_fields?: string[]; source?: string } | null
  lat: number | null
  lng: number | null
  seen_at: string
  created_at: string
  escalate_at: string | null
  expires_at: string | null
  reunited_at: string | null
}

export const CASE_COLUMNS =
  'id,kind,status,child_name,father_name,gender,age_est,clothing,flags,safe_point_id,transcript,ai_status,ai_extract,lat,lng,seen_at,created_at,escalate_at,expires_at,reunited_at'

/** One case, kept live via Realtime (RLS decides whether this user may see it). */
export function useLiveCase(caseId: string | null) {
  const [row, setRow] = useState<CaseRow | null>(null)

  useEffect(() => {
    if (!caseId) return setRow(null)
    let alive = true
    const load = () =>
      supabase
        .from('cases')
        .select(CASE_COLUMNS)
        .eq('id', caseId)
        .maybeSingle()
        .then(({ data }) => alive && setRow(data as CaseRow | null))
    void load()
    const ch = supabase
      .channel(`case-${caseId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cases', filter: `id=eq.${caseId}` }, () => void load())
      .subscribe()
    return () => {
      alive = false
      void supabase.removeChannel(ch)
    }
  }, [caseId])

  return row
}

export const shortId = (id: string) => id.slice(0, 4).toUpperCase()
