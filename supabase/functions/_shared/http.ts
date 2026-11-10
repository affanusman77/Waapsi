// Shared plumbing for edge functions: CORS, JSON responses, service client, caller identity.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

/** User-facing error: `code` is a stable i18n key suffix, `message` is for logs / developers. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code)
  }
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export type Profile = {
  id: string
  phone: string
  role: 'finder' | 'parent' | 'sp_staff' | 'admin' | 'police'
  display_name: string | null
  gender: 'male' | 'female' | null
  safe_point_id: string | null
}

/** Resolves the signed-in caller from the Authorization header, or throws 401. */
export async function getCaller(req: Request, admin: SupabaseClient): Promise<Profile> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'unauthenticated')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'unauthenticated')
  const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle()
  if (!profile) throw new HttpError(403, 'no_profile')
  return profile as Profile
}

/** Wraps a handler with CORS preflight, POST-only, JSON parsing and uniform error responses. */
export function handle(fn: (req: Request, body: Record<string, unknown>) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    try {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      return await fn(req, body)
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status)
      if (e instanceof Error && e.name === 'InvalidTransitionError') return json({ error: 'invalid_transition', message: e.message }, 409)
      console.error(e)
      return json({ error: 'server_error' }, 500)
    }
  }
}

/** Normalises Pakistani mobile numbers to +923XXXXXXXXX, or returns null. */
export function normalizePkPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let d = input.replace(/\D/g, '')
  if (d.startsWith('0092')) d = d.slice(2)
  if (d.startsWith('03')) d = '92' + d.slice(1)
  return /^923\d{9}$/.test(d) ? '+' + d : null
}
