// Runtime switches: function secret (env) first, then public.app_settings, then a safe default.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

let cache: { at: number; values: Record<string, string> } | null = null

async function dbSettings(admin: SupabaseClient): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.values
  const { data } = await admin.from('app_settings').select('key, value')
  const values = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
  cache = { at: Date.now(), values }
  return values
}

/** Demo mode (code 123456, demo reset). Off unless explicitly turned on. */
export async function demoMode(admin: SupabaseClient): Promise<boolean> {
  const env = Deno.env.get('DEMO_MODE')
  if (env) return env === 'true'
  return (await dbSettings(admin)).demo_mode === 'true'
}

/** Escalation time scale: 60 means 1 real minute counts as 1 hour. Defaults to real time. */
export async function timeScale(admin: SupabaseClient): Promise<number> {
  const raw = Deno.env.get('DEMO_TIME_SCALE') ?? (await dbSettings(admin)).demo_time_scale
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 && n <= 3600 ? n : 1
}

/** Any other setting: env var (UPPER_CASE) first, then the app_settings row (lower_case). */
export async function setting(admin: SupabaseClient, key: string): Promise<string | null> {
  const env = Deno.env.get(key.toUpperCase())?.trim()
  if (env) return env
  const v = (await dbSettings(admin))[key]?.trim()
  return v || null
}
