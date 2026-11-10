import { supabase } from './supabase'

export type Bucket = 'case-photos' | 'wrist-photos' | 'voice-notes' | 'child-profiles'

/**
 * Shrinks a camera photo to <=1280px JPEG before upload: cheap phones on 3G at a crowded
 * event can't push 5 MB photos. Falls back to the original file if the browser can't decode it (HEIC).
 */
export async function compressImage(file: File, maxSide = 1280, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
    return blob ?? file
  } catch {
    return file
  }
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
}

/** Uploads into the caller's own private folder (`<uid>/...`); returns the storage path. */
export async function uploadMedia(bucket: Bucket, blob: Blob): Promise<string> {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('not signed in')
  const type = blob.type.split(';')[0] || 'application/octet-stream'
  const path = `${data.user.id}/${crypto.randomUUID()}.${EXT[type] ?? 'bin'}`
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: type, upsert: false })
  if (error) throw error
  return path
}
