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
      <header className="sticky top-0 z-[1000] bg-cream/95 backdrop-blur border-b border-sand-deep">
        <div className={`mx-auto flex items-center gap-2 px-4 h-14 ${wide ? 'max-w-7xl' : 'max-w-xl'}`}>
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
          <Link to="/" className="flex items-baseline gap-2 font-bold text-lg tracking-tight">
            <span>{lang === 'ur' ? brand.nameUr : brand.name}</span>
            <span className="text-sm font-medium text-ink-soft hidden sm:inline">
              {lang === 'ur' ? brand.taglineUr : brand.tagline}
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleLang}
            className="ms-auto inline-flex h-11 items-center gap-2 rounded-full border border-sand-deep px-4 font-semibold hover:bg-sand"
            aria-label={t('common.switchLanguageLabel')}
          >
            <Languages className="size-5" aria-hidden />
            <span className={lang === 'en' ? 'font-urdu text-base leading-none' : ''}>{t('common.switchLanguage')}</span>
          </button>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-6 ${wide ? 'max-w-7xl' : 'max-w-xl'}`}>
        <Outlet />
      </main>
    </div>
  )
}
