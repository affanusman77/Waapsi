// OpenAI-compatible client (Groq recommended). Every call has a timeout and THROWS on failure;
// callers catch and fall back (R6: fail open). Nothing here ever changes a case's status.

const env = (k: string) => Deno.env.get(k)?.trim() || undefined

export function aiConfigured(): boolean {
  return !!(env('AI_BASE_URL') && env('AI_API_KEY'))
}

function base() {
  return env('AI_BASE_URL')!.replace(/\/+$/, '')
}
function auth() {
  return { Authorization: `Bearer ${env('AI_API_KEY')}` }
}

/** Whisper transcription. Saraiki isn't an official Whisper language: we let it auto-detect and the LLM normalises. */
export async function transcribe(audio: Blob, filename: string): Promise<{ text: string; language: string | null }> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', env('AI_STT_MODEL') ?? 'whisper-large-v3')
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0')
  // A vocabulary hint helps Whisper with Pakistani names and Roman-Urdu words.
  form.append('prompt', 'Bacha mila hai. Naam Ali, abu ka naam Raza. Hussain Agahi, Multan. Laal shirt, kali shalwar. Saraiki, Punjabi, Urdu.')
  const res = await fetch(`${base()}/audio/transcriptions`, { method: 'POST', headers: auth(), body: form, signal: AbortSignal.timeout(25_000) })
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  return { text: String(j.text ?? '').trim(), language: j.language ?? null }
}

/** Chat completion that must return a JSON object. */
export async function chatJSON(system: string, user: string, opts: { model?: string; timeoutMs?: number } = {}): Promise<unknown> {
  const model = opts.model ?? env('AI_LLM_MODEL')
  if (!model) throw new Error('AI_LLM_MODEL not set')
  const res = await fetch(`${base()}/chat/completions`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  })
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  const content = j.choices?.[0]?.message?.content ?? ''
  return JSON.parse(content)
}
