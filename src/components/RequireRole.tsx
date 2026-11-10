import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { useI18n } from '../i18n'
import { useSession, type Role } from '../lib/session'
import { supabaseConfigured } from '../lib/supabase'
import { PhoneLogin } from './PhoneLogin'
import { Button } from './Button'
import { Notice } from './ui'

export const DEMO_ACCOUNTS: Record<Role, { phone: string; label: string }[]> = {
  finder: [{ phone: '03000000001', label: 'Finder 0300-0000001' }],
  parent: [{ phone: '03000000002', label: 'Parent 0300-0000002' }],
  sp_staff: [
    { phone: '03000000003', label: 'Behan Desk 0300-0000003' },
    { phone: '03000000004', label: 'Help Desk 0300-0000004' },
  ],
  admin: [{ phone: '03000000005', label: 'Admin 0300-0000005' }],
  police: [{ phone: '03000000006', label: 'Police 0300-0000006' }],
}

/** Shows the phone login until the user is signed in with one of `roles`. */
export function RequireRole({
  roles,
  roleHint,
  children,
}: {
  roles: Role[]
  roleHint?: 'finder' | 'parent'
  children: ReactNode
}) {
  const { t } = useI18n()
  const { loading, session, profile, signOut } = useSession()

  if (!supabaseConfigured) return <Notice tone="danger">{t('common.notConfigured')}</Notice>
  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-sand" aria-label={t('common.loading')} />

  if (!session || !profile) {
    const demo = roles.flatMap((r) => DEMO_ACCOUNTS[r])
    return <PhoneLogin roleHint={roleHint} demoAccounts={demo} />
  }

  if (!roles.includes(profile.role)) {
    return (
      <div className="space-y-4">
        <Notice>{t('login.wrongRole', { role: t(`roles.${profile.role}`) })}</Notice>
        <Button variant="secondary" icon={<LogOut className="size-5" aria-hidden />} onClick={() => void signOut()}>
          {t('login.signOut')}
        </Button>
      </div>
    )
  }
  return <>{children}</>
}

export function SignedInAs() {
  const { t } = useI18n()
  const { profile, signOut } = useSession()
  if (!profile) return null
  return (
    <div className="mt-10 flex items-center justify-between gap-3 border-t border-sand-deep pt-4 text-sm text-ink-soft">
      <span dir="ltr">{profile.display_name ?? profile.phone}</span>
      <button type="button" onClick={() => void signOut()} className="inline-flex min-h-11 items-center gap-2 font-semibold underline-offset-4 hover:underline">
        <LogOut className="size-4" aria-hidden />
        {t('login.signOut')}
      </button>
    </div>
  )
}
