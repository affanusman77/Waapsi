import { useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'
import { useI18n } from '../i18n'

// Chrome/Edge/Samsung Internet fire this when the PWA can be installed.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/** "Add Wapsi to your home screen": a real install button on Android, a short hint on iPhone. Hidden once installed. */
export function InstallApp() {
  const { t } = useI18n()
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed || (!prompt && !isIos())) return null

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setPrompt(null)
  }

  return (
    <section className="flex items-center gap-4 rounded-2xl border border-sand-deep bg-sand p-4" aria-labelledby="install-title">
      <img src="/brand/icon-192.png" alt="" width={48} height={48} className="size-12 shrink-0" />
      <div className="min-w-0 flex-1">
        <h2 id="install-title" className="font-bold">{t('install.title')}</h2>
        {prompt ? (
          <p className="text-ink-soft">{t('install.lead')}</p>
        ) : (
          <p className="text-ink-soft">
            {t('install.ios')} <Share className="inline size-4 align-[-2px]" aria-hidden />
          </p>
        )}
      </div>
      {prompt && (
        <button
          type="button"
          onClick={() => void install()}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-maroon px-4 font-bold text-cream hover:bg-ink"
        >
          <Download className="size-5" aria-hidden />
          {t('install.button')}
        </button>
      )}
    </section>
  )
}
