import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Error from an edge function. `code` is stable (e.g. 'girls_need_women_staff') and maps to an i18n key. */
export class ApiError extends Error {
  constructor(public code: string, public status?: number) {
    super(code)
    this.name = 'ApiError'
  }
}

export async function callFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) {
    const detail = await error.context.json().catch(() => null)
    throw new ApiError(detail?.error ?? 'server_error', error.context.status)
  }
  throw new ApiError('network_error')
}

/** i18n key for an API error, falling back to a generic message. */
export function errorKey(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'network_error'
  return `errors.${code}`
}
