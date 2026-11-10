import { useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from './Button'
import { Notice } from './ui'
import { useI18n } from '../i18n'
import { callFn, errorKey } from '../lib/api'
import { useSession } from '../lib/session'

type Key = 'gallery_photo_match' | 'b_form_seen' | 'child_reaction_ok' | 'finder_confirmed' | 'female_staff_present'

/**
 * Safe point handover checklist (R3, R4, R11). Required items are enforced again on the server.
 * Girls: a female staff member must be present and be the one ticking it.
 * Under-4s: the B-form is required because the child can't confirm who their parent is.
 */
export function HandoverChecklist({ matchId, girl, under4, onDone }: { matchId: string; girl: boolean; under4: boolean; onDone?: () => void }) {
  const { t } = useI18n()
  const { profile } = useSession()
  const [cl, setCl] = useState<Record<Key, boolean>>({
    gallery_photo_match: false,
    b_form_seen: false,
    child_reaction_ok: false,
    finder_confirmed: true, // the match is only here because the finder (or staff) confirmed it
    female_staff_present: false,
  })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'verified' | 'failed' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmFail, setConfirmFail] = useState(false)

  const femaleOk = !girl || (cl.female_staff_present && (profile?.gender === 'female' || profile?.role === 'admin'))
  const required: Key[] = ['gallery_photo_match', 'child_reaction_ok', 'finder_confirmed', ...(under4 ? (['b_form_seen'] as Key[]) : [])]
  const ready = required.every((k) => cl[k]) && femaleOk

  const items: Array<{ key: Key; show: boolean; required: boolean }> = [
    { key: 'gallery_photo_match', show: true, required: true },
    { key: 'child_reaction_ok', show: true, required: true },
    { key: 'finder_confirmed', show: true, required: true },
    { key: 'b_form_seen', show: true, required: under4 },
    { key: 'female_staff_present', show: girl, required: girl },
  ]

  async function complete(result: 'verified' | 'failed') {
    setBusy(result)
    setError(null)
    try {
      await callFn('handover', { match_id: matchId, action: 'complete', result, checklist: cl, reason: result === 'failed' ? reason : undefined })
      onDone?.()
    } catch (e) {
      setError(errorKey(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-extrabold">{t('handover.title')}</h3>
      <ul className="space-y-2">
        {items
          .filter((i) => i.show)
          .map((i) => (
            <li key={i.key}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 border-sand-deep bg-white px-4 has-[:checked]:border-ink">
                <input
                  type="checkbox"
                  className="size-6 accent-[var(--brand-ink)]"
                  checked={cl[i.key]}
                  onChange={(e) => setCl({ ...cl, [i.key]: e.target.checked })}
                />
                <span className="flex-1 font-semibold">{t(`handover.items.${i.key}`)}</span>
                <span className="text-xs font-bold text-ink-soft">{i.required ? t('handover.required') : t('handover.optional')}</span>
              </label>
            </li>
          ))}
      </ul>
      {girl && profile?.gender !== 'female' && profile?.role !== 'admin' && <Notice tone="danger">{t('handover.needFemale')}</Notice>}

      <Button variant="success" disabled={!ready || !!busy} busy={busy === 'verified'} icon={<ShieldCheck className="size-6" aria-hidden />} onClick={() => void complete('verified')}>
        {t('handover.verify')}
      </Button>

      {!confirmFail ? (
        <Button variant="danger" icon={<ShieldAlert className="size-6" aria-hidden />} onClick={() => setConfirmFail(true)}>
          {t('handover.wrong')}
        </Button>
      ) : (
        <div className="space-y-3 rounded-xl border-2 border-danger bg-danger-soft p-4">
          <p className="font-bold text-danger">{t('handover.wrongExplain')}</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t('handover.reason')}
            className="w-full rounded-xl border-2 border-danger/40 bg-white p-3 outline-none focus:border-danger"
          />
          <Button variant="danger" busy={busy === 'failed'} disabled={!!busy} onClick={() => void complete('failed')}>
            {t('handover.blockNow')}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmFail(false)}>{t('common.back')}</Button>
        </div>
      )}
      {error && <Notice tone="danger">{t(error)}</Notice>}
    </section>
  )
}
