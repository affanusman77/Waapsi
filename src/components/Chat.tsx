import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Lock, SendHorizontal } from 'lucide-react'
import { useI18n } from '../i18n'
import { callFn, errorKey } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'

type Msg = { id: string; sender_id: string; body: string; created_at: string }

/** Masked chat for one match (R8): no phone numbers are ever exchanged; numbers typed are hidden. */
export function Chat({ matchId, open = true }: { matchId: string; open?: boolean }) {
  const { t, lang } = useI18n()
  const { profile } = useSession()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [maskedNote, setMaskedNote] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('messages').select('id,sender_id,body,created_at').eq('match_id', matchId).order('created_at')
    setMsgs((data as Msg[]) ?? [])
  }, [matchId])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel(`chat-${matchId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [load, matchId])

  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect must return nothing.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [msgs.length])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await callFn<{ message: { masked: boolean } }>('send-message', { match_id: matchId, body: text })
      setMaskedNote(r.message.masked)
      setText('')
      void load()
    } catch (err) {
      setError(errorKey(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border-2 border-sand-deep bg-white" aria-label={t('chat.title')}>
      <header className="flex items-center gap-2 border-b border-sand-deep px-4 py-3 font-bold">
        <Lock className="size-4 text-ink-soft" aria-hidden />
        {t('chat.title')}
        <span className="ms-auto text-xs font-medium text-ink-soft">{t('chat.private')}</span>
      </header>
      <ol className="max-h-72 space-y-2 overflow-y-auto p-4" aria-live="polite">
        {msgs.length === 0 && <li className="text-ink-soft">{t('chat.empty')}</li>}
        {msgs.map((m) => {
          const mine = m.sender_id === profile?.id
          return (
            <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <span className={`max-w-[80%] rounded-2xl px-4 py-2 ${mine ? 'bg-terracotta text-white' : 'bg-sand'}`}>
                {m.body}
                <time className={`mt-1 block text-xs ${mine ? 'text-white' : 'text-ink-soft'}`}>
                  {new Date(m.created_at).toLocaleTimeString(lang === 'ur' ? 'ur-PK' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </span>
            </li>
          )
        })}
        <div ref={end} />
      </ol>
      {open ? (
        <form onSubmit={send} className="flex gap-2 border-t border-sand-deep p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            className="min-h-12 flex-1 rounded-xl border-2 border-sand-deep px-3 outline-none focus:border-terracotta"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            aria-label={t('chat.send')}
            className="grid size-12 place-items-center rounded-xl bg-terracotta text-white disabled:opacity-50"
          >
            <SendHorizontal className="size-5 rtl:-scale-x-100" aria-hidden />
          </button>
        </form>
      ) : (
        <p className="border-t border-sand-deep p-3 text-sm text-ink-soft">{t('chat.closed')}</p>
      )}
      {maskedNote && <p className="px-4 pb-3 text-sm font-semibold text-terracotta">{t('chat.masked')}</p>}
      {error && <p className="px-4 pb-3 text-sm font-semibold text-danger">{t(error)}</p>}
    </section>
  )
}
