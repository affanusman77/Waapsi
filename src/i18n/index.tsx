import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import en from './en.json'
import ur from './ur.json'

export type Lang = 'en' | 'ur'
const dictionaries: Record<Lang, unknown> = { en, ur }
const STORAGE_KEY = 'wapsi.lang'

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node) node = (node as Record<string, unknown>)[part]
    else return undefined
  }
  return typeof node === 'string' ? node : undefined
}

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'en' || v === 'ur') return v
  } catch {
    /* storage blocked: fall through */
  }
  return 'en'
}

type I18n = {
  lang: Lang
  dir: 'ltr' | 'rtl'
  setLang: (l: Lang) => void
  toggleLang: () => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)
  const dir = lang === 'ur' ? 'rtl' : 'ltr'

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* ignore */
    }
  }, [lang, dir])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      // Missing Urdu strings fall back to English, then to the key itself.
      let s = lookup(dictionaries[lang], key) ?? lookup(dictionaries.en, key) ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
      return s
    },
    [lang],
  )

  const value = useMemo<I18n>(
    () => ({ lang, dir, setLang: setLangState, toggleLang: () => setLangState((l) => (l === 'en' ? 'ur' : 'en')), t }),
    [lang, dir, t],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
