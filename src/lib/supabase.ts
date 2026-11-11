import { createClient } from '@supabase/supabase-js'

// Accept the project URL even if it was pasted with the REST path (".../rest/v1/") or a trailing slash:
// supabase-js adds /rest/v1, /functions/v1, /storage/v1 itself, so those must not be doubled.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '')
  .replace(/\/(rest|auth|functions|storage|realtime)\/v1$/, '')
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

if (!supabaseConfigured) {
  console.warn('[wapsi] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing: data features are disabled.')
}

// A placeholder URL keeps the client constructible so screens can render their "not configured" state.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type SafePoint = {
  id: string
  name_en: string
  name_ur: string
  kind: 'shop' | 'mosque' | 'edhi' | 'police_desk' | 'event_desk'
  lat: number
  lng: number
  women_staff: boolean
  active: boolean
}
