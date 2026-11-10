import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { ArrowLeft, ArrowRight, Languages } from 'lucide-react'
import { brand } from '../config/brand'
import { useI18n } from '../i18n'

const WIDE_ROUTES = ['/admin', '/police']

export function AppShell() {
  const { t, lang, dir, toggleLang } = useI18n()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isHome = pathname === '/'
  const wide = WIDE_ROUTES.some((r) => pathname.startsWith(r))
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-[1000] border-b border-sand-deep bg-cream/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className={`mx-auto flex h-16 items-center gap-2 ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))] ${wide ? 'max-w-7xl' : 'max-w-xl'}`}>
          {!isHome && (
            <button
              type="button"
              onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
              className="-ms-2 grid size-11 place-items-center rounded-full hover:bg-sand"
              aria-label={t('common.back')}
            >
              <BackIcon className="size-6" aria-hidden />
            </button>
          )}
          <Link to="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight">
            <img src="/brand/logo.png" alt="" width={36} height={36} className="size-9 shrink-0" />
            <span>{lang === 'ur' ? brand.nameUr : brand.name}</span>
            <span className="text-sm font-medium text-ink-soft hidden sm:inline">
              {lang === 'ur' ? brand.taglineUr : brand.tagline}
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleLang}
            className="ms-auto inline-flex h-11 items-center gap-2 rounded-full border border-sand-deep px-4 font-semibold hover:bg-sand"
          >
            <Languages className="size-5" aria-hidden />
            <span lang={lang === 'en' ? 'ur' : 'en'} className={lang === 'en' ? 'font-urdu text-base leading-none' : 'font-sans leading-none'}>{t('common.switchLanguage')}</span>
            <span className="sr-only">{t('common.switchLanguageLabel')}</span>
          </button>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))] pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] ${wide ? 'max-w-7xl' : 'max-w-xl'}`}>
        <Outlet />
      </main>
    </div>
  )
}
