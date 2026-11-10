import { useState, type FormEvent } from 'react'
import { KeyRound, Phone } from 'lucide-react'
import { Button } from './Button'
import { Notice, PageHeader } from './ui'
import { useI18n } from '../i18n'
import { useSession } from '../lib/session'
import { errorKey } from '../lib/api'
import { flags } from '../config/flags'

type DemoAccount = { phone: string; label: string }

/** Screen 1 of every flow: one big phone field, then the code. */
export function PhoneLogin({ roleHint = 'finder', demoAccounts = [] }: { roleHint?: 'finder' | 'parent'; demoAccounts?: DemoAccount[] }) {
  const { t } = useI18n()
  const { signInWithPhone } = useSession()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validPhone = /^(\+?92|0)?3\d{9}$/.test(phone.replace(/[\s-]/g, ''))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (step === 'phone') {
      if (validPhone) setStep('code')
      else setError('errors.invalid_phone')
      return
    }
    setBusy(true)
    try {
      await signInWithPhone(phone, code, roleHint)
    } catch (err) {
      setError(errorKey(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PageHeader title={t('login.title')} lead={t('login.lead')} />
      {step === 'phone' ? (
        <label className="block">
          <span className="mb-2 block text-lg font-semibold">{t('login.phoneLabel')}</span>
          <span className="relative block">
            <Phone className="pointer-events-none absolute start-4 top-1/2 size-6 -translate-y-1/2 text-ink-soft" aria-hidden />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="03XX XXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-16 w-full rounded-2xl border-2 border-sand-deep bg-white ps-14 pe-4 text-2xl tracking-wide outline-none focus:border-terracotta"
              autoFocus
            />
          </span>
        </label>
      ) : (
        <label className="block">
          <span className="mb-2 block text-lg font-semibold">{t('login.codeLabel', { phone })}</span>
          <span className="relative block">
            <KeyRound className="pointer-events-none absolute start-4 top-1/2 size-6 -translate-y-1/2 text-ink-soft" aria-hidden />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="h-16 w-full rounded-2xl border-2 border-sand-deep bg-white ps-14 pe-4 text-3xl tracking-[0.4em] outline-none focus:border-terracotta"
              autoFocus
            />
          </span>
          {flags.demoMode && <span className="mt-2 block text-ink-soft">{t('login.demoCode')}</span>}
        </label>
      )}

      {error && <Notice tone="danger">{t(error)}</Notice>}

      <Button type="submit" busy={busy} disabled={step === 'code' && code.length !== 6}>
        {step === 'phone' ? t('login.sendCode') : t('login.verify')}
      </Button>
      {step === 'code' && (
        <Button variant="ghost" onClick={() => { setStep('phone'); setCode('') }}>
          {t('login.changeNumber')}
        </Button>
      )}

      {flags.demoMode && demoAccounts.length > 0 && step === 'phone' && (
        <div className="rounded-xl border border-dashed border-sand-deep p-3">
          <p className="mb-2 text-sm font-semibold text-ink-soft">{t('login.demoAccounts')}</p>
          <div className="flex flex-wrap gap-2">
            {demoAccounts.map((a) => (
              <button
                key={a.phone}
                type="button"
                onClick={() => { setPhone(a.phone); setStep('code'); setCode('123456') }}
                className="min-h-11 rounded-full border border-sand-deep bg-sand px-4 text-sm font-semibold hover:bg-sand-deep"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  )
}
