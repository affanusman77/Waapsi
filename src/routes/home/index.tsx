import { Link } from 'react-router'
import { ArrowLeft, ArrowRight, Camera, HandHeart, LayoutDashboard, Search, ShieldCheck, Siren } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '../../components/ui'
import { useI18n } from '../../i18n'

const ROLES: Array<{ key: string; to: string; icon: LucideIcon; primary?: boolean }> = [
  { key: 'finder', to: '/f', icon: HandHeart, primary: true },
  { key: 'parent', to: '/p', icon: Search, primary: true },
  { key: 'checkin', to: '/checkin', icon: Camera },
  { key: 'sp', to: '/sp', icon: ShieldCheck },
  { key: 'admin', to: '/admin', icon: LayoutDashboard },
  { key: 'police', to: '/police', icon: Siren },
]

export default function Home() {
  const { t, dir } = useI18n()
  const Chevron = dir === 'rtl' ? ArrowLeft : ArrowRight
  return (
    <>
      <PageHeader title={t('home.title')} lead={t('home.subtitle')} />
      <ul className="grid gap-3">
        {ROLES.map(({ key, to, icon: Icon, primary }) => (
          <li key={key}>
            <Link
              to={to}
              className={`flex min-h-16 items-center gap-4 rounded-2xl p-4 transition-colors ${
                primary
                  ? 'bg-terracotta text-white hover:bg-terracotta-deep'
                  : 'border border-sand-deep bg-sand hover:bg-sand-deep'
              }`}
            >
              <Icon className="size-7 shrink-0" aria-hidden />
              <span className="flex-1">
                <span className="block text-lg font-bold">{t(`home.roles.${key}.title`)}</span>
                <span className={`block ${primary ? 'text-white/90' : 'text-ink-soft'}`}>{t(`home.roles.${key}.desc`)}</span>
              </span>
              <Chevron className="size-5 shrink-0 opacity-80" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
