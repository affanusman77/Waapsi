// F3: WhatsApp alerts (Meta WhatsApp Cloud API, or Twilio's WhatsApp API).
//
// Who gets what:
//   police      : every new found/lost case, and every police status change until handover (R12)
//   safe point  : "a child is being brought to you" when a finder picks that safe point (R10)
//   parent      : possible match found / reunited (no photo, no place: R1/R2)
//
// Rules: never a photo, never coordinates, phone numbers masked in the audit log (R8).
// Fails open (R6): a WhatsApp error is logged and audited, it never blocks or undoes a case step.
// Without META_WA_* or TWILIO_* secrets every message is "simulated": written to the audit log only.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { audit } from './audit.ts'
import { haversineMeters } from './geo.ts'
import { setting } from './settings.ts'
import { buildAlerts, GEOFENCE_KM, geofenceMessage, safePointsWithin, type LostCaseLite, type SafePointLite } from './geofence.ts'
import type { CaseStatus } from './state.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const env = (k: string) => Deno.env.get(k)?.trim() || undefined

// Two providers. Meta's WhatsApp Cloud API is preferred (free test number, works in Pakistan, where
// Twilio no longer offers trials); Twilio stays as an alternative. Neither set = simulated.
const metaConfigured = () => !!(env('META_WA_TOKEN') && env('META_WA_PHONE_ID'))
const twilioConfigured = () => !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_WHATSAPP_FROM'))

export function whatsappConfigured(): boolean {
  return metaConfigured() || twilioConfigured()
}

/** Meta WhatsApp Cloud API. Free-form text reaches people who messaged the business number in the last 24 h. */
async function sendViaMeta(to: string, body: string): Promise<string | null> {
  const version = env('META_WA_API_VERSION') ?? 'v23.0' // Meta upgrades retired versions automatically
  const res = await fetch(`https://graph.facebook.com/${version}/${env('META_WA_PHONE_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('META_WA_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'text', text: { preview_url: false, body } }),
    signal: AbortSignal.timeout(8000),
  })
  return res.ok ? null : `meta ${res.status} ${(await res.text()).slice(0, 300)}`
}

async function sendViaTwilio(to: string, body: string): Promise<string | null> {
  const sid = env('TWILIO_ACCOUNT_SID')!
  const from = env('TWILIO_WHATSAPP_FROM')!
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${env('TWILIO_AUTH_TOKEN')}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`, To: `whatsapp:${to}`, Body: body }),
    signal: AbortSignal.timeout(8000),
  })
  return res.ok ? null : `twilio ${res.status} ${(await res.text()).slice(0, 200)}`
}

function mask(phone: string): string {
  const d = phone.replace(/\D/g, '')
  return d.length < 4 ? '****' : `03xx-xxxx-x${d.slice(-2)}`
}

/** Sends one WhatsApp text. Never throws. */
export async function sendWhatsApp(
  admin: SupabaseClient,
  to: string,
  body: string,
  meta: { template: string; caseId?: string | null },
): Promise<boolean> {
  let delivered = false
  let error: string | null = null
  const simulated = !whatsappConfigured()
  const provider = metaConfigured() ? 'meta' : twilioConfigured() ? 'twilio' : null
  if (!simulated) {
    try {
      error = provider === 'meta' ? await sendViaMeta(to, body) : await sendViaTwilio(to, body)
      delivered = !error
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }
  if (error) console.error('[whatsapp]', meta.template, error)
  await audit(admin, {
    action: 'notify.whatsapp',
    actor: { type: 'system' },
    caseId: meta.caseId ?? null,
    payload: { to: mask(to), template: meta.template, provider, delivered, simulated, ...(error ? { error } : {}) },
  })
  return delivered
}

/** Runs after the HTTP response is sent; errors are swallowed (fail open). */
export function notifyLater(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error('[whatsapp] background', e))
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(guarded)
}

// ---------------- recipients ----------------

function phoneList(raw: string | null): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter((p) => /^\+\d{10,15}$/.test(p))
}

/** Police control-room numbers: secret POLICE_WHATSAPP or app_settings.police_whatsapp (comma-separated, +92…). */
async function policeNumbers(admin: SupabaseClient): Promise<string[]> {
  return phoneList(await setting(admin, 'police_whatsapp'))
}

async function staffNumbers(admin: SupabaseClient, safePointId: string): Promise<string[]> {
  const { data } = await admin.from('profiles').select('phone').eq('role', 'sp_staff').eq('safe_point_id', safePointId)
  return phoneList((data ?? []).map((r) => r.phone).join(','))
}

async function reporterNumber(admin: SupabaseClient, reporterId: string | null): Promise<string | null> {
  if (!reporterId) return null
  const { data } = await admin.from('profiles').select('phone').eq('id', reporterId).maybeSingle()
  return phoneList(data?.phone ?? null)[0] ?? null
}

// ---------------- message text (Urdu-in-Latin + English, short) ----------------

type CaseRow = {
  id: string
  kind: 'found' | 'lost' | 'checkin'
  status: CaseStatus
  reporter_id: string | null
  child_name: string | null
  age_est: number | null
  gender: 'male' | 'female' | null
  clothing: { top_color?: string | null; top_type?: string | null } | null
  lat: number | null
  lng: number | null
  safe_point_id: string | null
  flags: string[]
}

const shortId = (id: string) => id.slice(0, 6).toUpperCase()

function describe(c: CaseRow): string {
  const who = c.gender === 'female' ? 'girl' : c.gender === 'male' ? 'boy' : 'child'
  const parts = [c.age_est !== null ? `${who}, ~${c.age_est}y` : who]
  if (c.clothing?.top_color) parts.push(`${c.clothing.top_color} ${c.clothing.top_type ?? 'top'}`)
  if (c.child_name) parts.push(`says name "${c.child_name}"`)
  if (c.flags.includes('under_4')) parts.push('UNDER 4')
  return parts.join(', ')
}

async function appLink(admin: SupabaseClient, path: string): Promise<string> {
  const base = (await setting(admin, 'app_url')) ?? ''
  return base ? `${base.replace(/\/+$/, '')}${path}` : ''
}

async function loadCase(admin: SupabaseClient, caseId: string): Promise<CaseRow | null> {
  const { data } = await admin
    .from('cases')
    .select('id, kind, status, reporter_id, child_name, age_est, gender, clothing, lat, lng, safe_point_id, flags')
    .eq('id', caseId)
    .maybeSingle()
  return (data as CaseRow | null) ?? null
}

/** A landmark instead of coordinates: the nearest safe point's name (never exact location, R1). */
async function nearLandmark(admin: SupabaseClient, c: CaseRow): Promise<string | null> {
  if (c.lat === null || c.lng === null) return null
  const { data } = await admin.from('safe_points').select('name_en, lat, lng').eq('active', true)
  let best: { name: string; d: number } | null = null
  for (const sp of data ?? []) {
    const d = haversineMeters({ lat: c.lat, lng: c.lng }, sp)
    if (!best || d < best.d) best = { name: sp.name_en, d }
  }
  return best ? best.name : null
}

async function safePointName(admin: SupabaseClient, id: string | null): Promise<string | null> {
  if (!id) return null
  const { data } = await admin.from('safe_points').select('name_en').eq('id', id).maybeSingle()
  return data?.name_en ?? null
}

// ---------------- events ----------------

/** New case filed: police get a record alert (found + lost; check-ins stay quiet). */
export async function notifyCaseCreated(admin: SupabaseClient, caseId: string): Promise<void> {
  const c = await loadCase(admin, caseId)
  if (!c || c.kind === 'checkin') return
  if (c.kind === 'lost') await notifyGeofence(admin, caseId)
  const police = await policeNumbers(admin)
  if (!police.length) return
  const near = await nearLandmark(admin, c)
  const link = await appLink(admin, '/police')
  const head = c.kind === 'found' ? '🟡 Wapsi: bacha mila / CHILD FOUND' : '🔴 Wapsi: bacha gum / CHILD MISSING'
  const body = [
    `${head} · case #${shortId(c.id)}`,
    describe(c),
    near ? `Near / qareeb: ${near}` : null,
    'Police status: Record only',
    link ? `Details: ${link}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  await Promise.all(police.map((to) => sendWhatsApp(admin, to, body, { template: `police.case_created.${c.kind}`, caseId })))
}

/** Called after every successful status change (from the transition store). */
export async function notifyTransition(admin: SupabaseClient, caseId: string, to: CaseStatus, policeStatus: string | null): Promise<void> {
  const c = await loadCase(admin, caseId)
  if (!c) return
  const jobs: Promise<unknown>[] = []
  const id = shortId(c.id)

  // R12: police follow every custody step until handover.
  if (policeStatus) {
    const police = await policeNumbers(admin)
    const sp = await safePointName(admin, c.safe_point_id)
    const icon = policeStatus.startsWith('URGENT') ? '🚨' : policeStatus === 'Reunited' ? '✅' : '🔵'
    const link = await appLink(admin, '/police')
    const body = [
      `${icon} Wapsi case #${id}: ${policeStatus}`,
      describe(c),
      sp ? `Safe point: ${sp}` : null,
      link ? `Details: ${link}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    for (const p of police) jobs.push(sendWhatsApp(admin, p, body, { template: `police.${to}`, caseId }))
  }

  // R10: the safe point hears that a child is on the way.
  if (to === 'awaiting_safe_point' && c.safe_point_id) {
    const staff = await staffNumbers(admin, c.safe_point_id)
    const link = await appLink(admin, '/sp')
    const girl = c.gender === 'female' ? '\nLarki hai: female staff zaroori / Girl: female staff must be present.' : ''
    const body = `🧒 Wapsi: ek bacha aap ke paas laya ja raha hai / A child is being brought to you (case #${id}).\n${describe(c)}${girl}\nPlease accept the child in the app when they arrive.${link ? `\n${link}` : ''}`
    for (const s of staff) jobs.push(sendWhatsApp(admin, s, body, { template: 'sp.incoming', caseId }))
  }

  // Parent updates (lost reports and check-ins only): no photo, no location (R2).
  if (c.kind !== 'found' && (to === 'matched' || to === 'reunited')) {
    const parent = await reporterNumber(admin, c.reporter_id)
    if (parent) {
      const link = await appLink(admin, '/p')
      const body =
        to === 'matched'
          ? `Wapsi: mumkin hai aap ka bacha mil gaya hai. App kholein. / A possible match was found for case #${id}. Open the app for next steps.${link ? `\n${link}` : ''}`
          : `✅ Wapsi: bacha ghar wapas. Case #${id} is closed as reunited. Shukriya.`
      jobs.push(sendWhatsApp(admin, parent, body, { template: `parent.${to}`, caseId }))
    }
  }

  await Promise.all(jobs)
}

/**
 * Geofenced alert: a child is missing -> staff at every active safe point within 20 km of the
 * last-seen point get a WhatsApp alert (no name, no photo, no exact location). Police already get
 * every case. The public is never alerted. Always audited, so the control room sees who was told.
 */
export async function notifyGeofence(admin: SupabaseClient, caseId: string): Promise<void> {
  const { data: c } = await admin.from('cases').select('id, kind, gender, age_est, clothing, lat, lng, seen_at, status, flags').eq('id', caseId).maybeSingle()
  if (!c || c.kind !== 'lost' || c.lat === null || c.lng === null) return
  const { data: points } = await admin.from('safe_points').select('id, name_en, name_ur, lat, lng').eq('active', true)
  const inRange = safePointsWithin({ lat: c.lat, lng: c.lng }, (points ?? []) as SafePointLite[])
  const [alert] = buildAlerts([c as LostCaseLite], (points ?? []) as SafePointLite[], null)
  const body = alert ? geofenceMessage(alert) : null
  let staff = 0
  if (body) {
    const jobs: Promise<unknown>[] = []
    for (const sp of inRange) {
      for (const to of await staffNumbers(admin, sp.id)) {
        staff++
        jobs.push(sendWhatsApp(admin, to, body, { template: 'sp.geofence_missing', caseId }))
      }
    }
    await Promise.all(jobs)
  }
  await audit(admin, {
    action: 'alert.geofence',
    actor: { type: 'system' },
    caseId,
    payload: { radius_km: GEOFENCE_KM, safe_points: inRange.map((p) => p.name_en), staff_alerted: staff, public: false },
  })
}
