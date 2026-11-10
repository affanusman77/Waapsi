/**
 * Every user-facing name and the colour palette live here.
 * Renaming the product (e.g. Wapsi -> Amaan) means editing this file only.
 * Colours are pushed into CSS variables at boot (see applyBrandTheme) and the
 * Tailwind theme in index.css reads those variables, so this is the single source.
 */
export const brand = {
  name: 'Wapsi',
  nameUr: 'واپسی',
  /** Name of the reunion flow (kept separate in case the platform is renamed). */
  flowName: 'Wapsi',
  flowNameUr: 'واپسی',
  tagline: 'Har bacha ghar wapas.',
  taglineUr: 'ہر بچہ گھر واپس',
  checkinName: 'Aaj ki Tasveer',
  checkinNameUr: 'آج کی تصویر',
  womenDeskName: 'Behan Desk',
  womenDeskNameUr: 'بہن ڈیسک',
} as const

export const colors = {
  cream: '#FBF6EE', // page background
  sand: '#F3E8D6', // cards
  sandDeep: '#E6D5BA', // borders, dividers
  ink: '#2A1B16', // body text, warm brown to sit with the diya logo (15.4:1 on cream)
  inkSoft: '#665449', // secondary text (6.7:1 on cream, 5.0:1 on sand-deep)
  maroon: '#2A0B08', // logo disc
  tan: '#D8BF98', // logo flame and bowl (10.3:1 on maroon)
  terracotta: '#B4532A', // primary action (5.0:1 with white text)
  terracottaDeep: '#93411F', // primary pressed
  reunited: '#1F7A6D', // calm teal: "Reunited" only
  reunitedSoft: '#D7EDE8',
  danger: '#B42318', // red ONLY for escalation, police, blocked
  dangerSoft: '#FBE3E0',
} as const

export type BrandColor = keyof typeof colors

export function applyBrandTheme(root: HTMLElement = document.documentElement) {
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--brand-${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`, value)
  }
}
