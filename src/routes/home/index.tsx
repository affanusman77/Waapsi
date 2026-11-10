import { Link } from 'react-router'
import { ArrowLeft, ArrowRight, Camera, HandHeart, LayoutDashboard, Search, ShieldCheck, Siren } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '../../components/ui'
import { InstallApp } from '../../components/InstallApp'
import { brand } from '../../config/brand'
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
  const { t, dir, lang } = useI18n()
  const Chevron = dir === 'rtl' ? ArrowLeft : ArrowRight
  return (
    <div className="space-y-6">
      {/* The diya sits on its own maroon, so the disc melts into the band and only the flame and bowl show. */}
      <div className="flex items-center gap-4 rounded-3xl bg-maroon px-5 py-4 text-cream">
        <img src="/brand/logo.png" alt="" width={72} height={72} className="size-18 shrink-0" />
        <div className="min-w-0">
          <p className="text-2xl font-extrabold tracking-tight">
            <span lang="en" className="font-sans">{brand.name}</span> <span lang="ur" className="font-urdu text-xl font-semibold text-tan">{brand.nameUr}</span>
          </p>
          <p className="text-tan" lang={lang === 'ur' ? 'ur' : undefined}>{lang === 'ur' ? brand.taglineUr : brand.tagline}</p>
        </div>
      </div>

      <div>
        <PageHeader title={t('home.title')} lead={t('home.subtitle')} />
        <ul className="grid gap-3">
          {ROLES.map(({ key, to, icon: Icon, primary }) => (
            <li key={key}>
              <Link
                to={to}
                className={`flex min-h-16 items-center gap-4 rounded-2xl p-4 transition-colors ${
                  primary ? 'bg-terracotta text-white hover:bg-terracotta-deep' : 'border border-sand-deep bg-sand hover:bg-sand-deep'
                }`}
              >
                <Icon className="size-7 shrink-0" aria-hidden />
                <span className="flex-1">
                  <span className="block text-lg font-bold">{t(`home.roles.${key}.title`)}</span>
                  <span className={`block ${primary ? 'text-white' : 'text-ink-soft'}`}>{t(`home.roles.${key}.desc`)}</span>
                </span>
                <Chevron className="size-5 shrink-0 opacity-80" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <InstallApp />
    </div>
  )
}
