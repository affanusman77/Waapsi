import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './supabase'
import { callFn } from './api'

export type Role = 'finder' | 'parent' | 'sp_staff' | 'admin' | 'police'
export type Profile = {
  id: string
  phone: string
  role: Role
  display_name: string | null
  gender: 'male' | 'female' | null
  safe_point_id: string | null
}

type SessionState = {
  loading: boolean
  session: Session | null
  profile: Profile | null
  signInWithPhone: (phone: string, code: string, roleHint: 'finder' | 'parent') => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(supabaseConfigured)

  useEffect(() => {
    if (!supabaseConfigured) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    setLoading(true)
    void supabase
      .from('profiles')
      .select('id, phone, role, display_name, gender, safe_point_id')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        setProfile((data as Profile) ?? null)
        setLoading(false)
      })
  }, [userId])

  const signInWithPhone = useCallback(async (phone: string, code: string, roleHint: 'finder' | 'parent') => {
    const { token_hash } = await callFn<{ token_hash: string }>('demo-otp', { phone, code, role_hint: roleHint })
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return <Ctx.Provider value={{ loading, session, profile, signInWithPhone, signOut }}>{children}</Ctx.Provider>
}

export function useSession() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
