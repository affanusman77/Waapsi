import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { CASE_COLUMNS, type CaseRow } from './useLiveCase'

export type PoliceRow = { case_id: string; station: string | null; status: string; updated_at: string }
export type AuditRow = { id: number; case_id: string | null; actor: 'human' | 'ai' | 'system'; action: string; created_at: string }

/**
 * Control-room feed (admin / police): recent cases, their police records and the audit log,
 * all live. RLS returns nothing to anyone else, so this hook is safe to mount anywhere.
 */
export function useControlFeed() {
  const [cases, setCases] = useState<CaseRow[] | null>(null)
  const [police, setPolice] = useState<Record<string, PoliceRow>>({})
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    const [c, p, a] = await Promise.all([
      supabase.from('cases').select(CASE_COLUMNS).gte('created_at', since).order('created_at', { ascending: false }).limit(200),
      supabase.from('police_records').select('case_id,station,status,updated_at').gte('updated_at', since).limit(500),
      supabase.from('audit_log').select('id,case_id,actor,action,created_at').order('id', { ascending: false }).limit(40),
    ])
    setError(!!(c.error || p.error || a.error))
    if (c.data) setCases(c.data as CaseRow[])
    if (p.data) setPolice(Object.fromEntries((p.data as PoliceRow[]).map((r) => [r.case_id, r])))
    if (a.data) setAudit(a.data as AuditRow[])
  }, [])

  useEffect(() => {
    void load()
    // Coalesce bursts (one transition touches 3 tables) into a single reload.
    let pending: number | undefined
    const reload = () => {
      window.clearTimeout(pending)
      pending = window.setTimeout(() => void load(), 150)
    }
    const ch = supabase
      .channel('control-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'police_records' }, reload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, reload)
      .subscribe()
    return () => {
      window.clearTimeout(pending)
      void supabase.removeChannel(ch)
    }
  }, [load])

  return { cases, police, audit, error, reload: load }
}
