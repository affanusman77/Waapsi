// Face check against Amazon Rekognition, run ONCE per newly suggested match (see face.ts for the rules).
// Secrets: REKOGNITION_ACCESS_KEY_ID, REKOGNITION_SECRET_ACCESS_KEY, REKOGNITION_REGION (default ap-southeast-2).
// Without them the check is off and nothing is shown. Fails open: an AWS error never blocks a match (R6).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { audit } from './audit.ts'
import { assessPhoto, faceReason, type DetectedFace, type FaceReason } from './face.ts'

const env = (k: string) => Deno.env.get(k)?.trim() || undefined

export function faceCheckConfigured(): boolean {
  return !!(env('REKOGNITION_ACCESS_KEY_ID') && env('REKOGNITION_SECRET_ACCESS_KEY'))
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function rekognition<T>(target: 'DetectFaces' | 'CompareFaces', body: unknown): Promise<T> {
  const region = env('REKOGNITION_REGION') ?? 'ap-southeast-2'
  const aws = new AwsClient({
    accessKeyId: env('REKOGNITION_ACCESS_KEY_ID')!,
    secretAccessKey: env('REKOGNITION_SECRET_ACCESS_KEY')!,
    region,
    service: 'rekognition',
  })
  const res = await aws.fetch(`https://rekognition.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `RekognitionService.${target}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`${target} ${res.status} ${json.__type ?? ''} ${json.message ?? json.Message ?? ''}`.trim())
  return json as T
}

const detectFaces = async (b64: string) =>
  (await rekognition<{ FaceDetails?: DetectedFace[] }>('DetectFaces', { Image: { Bytes: b64 }, Attributes: ['DEFAULT'] })).FaceDetails ?? []

/** DetectFaces with every attribute (age range, gender, quality, pose): used by photo-check. */
export const detectFacesAll = async (b64: string) =>
  (await rekognition<{ FaceDetails?: DetectedFace[] }>('DetectFaces', { Image: { Bytes: b64 }, Attributes: ['ALL'] })).FaceDetails ?? []

/** Downloads a photo from a bucket as base64 (Rekognition's 5 MB limit applies). */
export async function photoBytes(admin: SupabaseClient, bucket: string, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).download(path)
  if (error || !data) throw new Error(`photo download failed: ${error?.message ?? 'empty'}`)
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (bytes.length > 5 * 1024 * 1024) throw new Error('photo over 5 MB (Rekognition limit)')
  return toBase64(bytes)
}

/** Highest similarity (0–100) between the main face in `source` and any face in `target`. */
async function compareFaces(source: string, target: string): Promise<number> {
  const r = await rekognition<{ FaceMatches?: Array<{ Similarity?: number }> }>('CompareFaces', {
    SourceImage: { Bytes: source },
    TargetImage: { Bytes: target },
    SimilarityThreshold: 0, // return every comparison; we band the number ourselves
    QualityFilter: 'NONE', // quality is already checked by assessPhoto, with a reason we can show
  })
  return Math.max(0, ...(r.FaceMatches ?? []).map((m) => m.Similarity ?? 0))
}

async function photo(admin: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await admin.storage.from('case-photos').download(path)
  if (error || !data) throw new Error(`photo download failed: ${error?.message ?? 'empty'}`)
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (bytes.length > 5 * 1024 * 1024) throw new Error('photo over 5 MB (Rekognition limit)')
  return toBase64(bytes)
}

/** Runs the face check for one match and stores the result as its `face` reason. Never throws. */
export async function checkFaces(admin: SupabaseClient, matchId: string): Promise<FaceReason | null> {
  if (!faceCheckConfigured()) return null
  const { data: m } = await admin.from('matches').select('id, found_case_id, lost_case_id, reasons').eq('id', matchId).maybeSingle()
  if (!m) return null
  const { data: rows } = await admin.from('cases').select('id, photo_path, flags').in('id', [m.found_case_id, m.lost_case_id])
  const found = rows?.find((r) => r.id === m.found_case_id)
  const lost = rows?.find((r) => r.id === m.lost_case_id)

  let reason: FaceReason
  try {
    if (!found?.photo_path) reason = faceReason({ status: 'no_photo', which: 'child' })
    else if (!lost?.photo_path) reason = faceReason({ status: 'no_photo', which: 'parent' })
    else {
      const [child, family] = await Promise.all([photo(admin, found.photo_path), photo(admin, lost.photo_path)])
      const [childFaces, familyFaces] = await Promise.all([detectFaces(child), detectFaces(family)])
      const c = assessPhoto(childFaces)
      const f = assessPhoto(familyFaces)
      if (!c.ok) reason = faceReason({ status: 'unclear', which: 'child', why: c.why })
      else if (!f.ok) reason = faceReason({ status: 'unclear', which: 'parent', why: f.why })
      else {
        const similarity = await compareFaces(family, child)
        reason = faceReason({ status: 'checked', similarity, under4: (found.flags ?? []).includes('under_4') })
      }
    }
  } catch (e) {
    console.error('[face-check]', e)
    reason = faceReason({ status: 'error' })
  }

  const others = (Array.isArray(m.reasons) ? m.reasons : []).filter((r: { factor?: string }) => r?.factor !== 'face')
  await admin.from('matches').update({ reasons: [...others, reason] }).eq('id', matchId)
  await audit(admin, {
    action: 'match.face_checked',
    actor: { type: 'ai' },
    caseId: m.found_case_id,
    matchId,
    payload: { status: reason.status, similarity: reason.similarity ?? null, which: reason.which ?? null, why: reason.why ?? null },
  })
  return reason
}
