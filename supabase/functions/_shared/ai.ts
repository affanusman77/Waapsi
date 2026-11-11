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

// Providers retire and rename chat models often. When the configured model is missing (or none is set),
// ask the provider which models this key can use and take the best general chat model.
let discoveredModel: string | null = null
const MODEL_PREFERENCE = [/gpt-oss-120b/, /llama-3\.3-70b/, /llama-4-maverick/, /kimi-k2/, /qwen3-32b/, /llama-4-scout/, /gpt-oss-20b/, /llama-3\.1-8b/]
const NOT_CHAT = /whisper|tts|guard|playai|orpheus|compound|embed|vision|safeguard/i

export async function availableModels(): Promise<string[]> {
  const res = await fetch(`${base()}/models`, { headers: auth(), signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`models ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  return ((j.data ?? []) as Array<{ id: string }>).map((m) => m.id)
}

async function discoverModel(): Promise<string | null> {
  const chat = (await availableModels()).filter((id) => !NOT_CHAT.test(id))
  for (const p of MODEL_PREFERENCE) {
    const hit = chat.find((id) => p.test(id))
    if (hit) return hit
  }
  return chat[0] ?? null
}

/** The chat model actually in use (for audit payloads). */
export const activeModel = () => discoveredModel ?? env('AI_LLM_MODEL') ?? null

async function chatOnce(model: string, system: string, user: string, timeoutMs: number) {
  return await fetch(`${base()}/chat/completions`, {
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
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/** Chat completion that must return a JSON object. */
export async function chatJSON(system: string, user: string, opts: { model?: string; timeoutMs?: number } = {}): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  let model = opts.model ?? discoveredModel ?? env('AI_LLM_MODEL') ?? (await discoverModel())
  if (!model) throw new Error('no chat model available for this key')
  let res = await chatOnce(model, system, user, timeoutMs)
  if (res.status === 404 || res.status === 400) {
    const body = await res.text()
    if (!/model_not_found|model_decommissioned|does not exist|decommissioned/i.test(body)) throw new Error(`chat ${res.status}: ${body.slice(0, 200)}`)
    const next = await discoverModel()
    if (!next || next === model) throw new Error(`chat ${res.status}: ${body.slice(0, 200)}`)
    discoveredModel = model = next
    console.info('[ai] configured chat model unavailable; using', model)
    res = await chatOnce(model, system, user, timeoutMs)
  }
  if (!res.ok) throw new Error(`chat ${res.status} (${model}): ${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  const content = j.choices?.[0]?.message?.content ?? ''
  return JSON.parse(content)
}
