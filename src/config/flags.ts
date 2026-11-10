/**
 * Feature flags. New features (incl. the Mystery Card) ship as modules in
 * src/features/<name>/ behind a flag here, so the core flow is never destabilised.
 */
export const flags = {
  demoMode: import.meta.env.VITE_DEMO_MODE !== 'false',
  eventReport: false, // P5
} as const

export type FlagName = keyof typeof flags
