import { useCallback, useEffect, useState } from 'react'
import { supabase, supabaseConfigured, type SafePoint } from './supabase'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; points: SafePoint[] }

/** Active safe points, kept live via Realtime so newly onboarded points appear without a reload. */
export function useSafePoints() {
  const [state, setState] = useState<State>(
    supabaseConfigured ? { status: 'loading' } : { status: 'error', message: 'not-configured' },
  )

  const load = useCallback(async () => {
    if (!supabaseConfigured) return
    const { data, error } = await supabase
      .from('safe_points')
      .select('id,name_en,name_ur,kind,lat,lng,women_staff,active')
      .eq('active', true)
      .order('name_en')
    setState(error ? { status: 'error', message: error.message } : { status: 'ready', points: data as SafePoint[] })
  }, [])

  useEffect(() => {
    if (!supabaseConfigured) return
    void load()
    const channel = supabase
      .channel('safe-points')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'safe_points' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  return { state, reload: load }
}
