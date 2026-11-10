# Wapsi (واپسی)

*Har bacha ghar wapas.* A lost-child reunion platform for crowded events. Finders report a found child in about 30 seconds, AI structures the report and suggests matches, **humans confirm**, and a **safe point verifies every handover**, with police informed at every step.

Full build spec: [docs/SPEC.md](docs/SPEC.md).

## Stack

React + Vite + TypeScript, Tailwind v4, React Router, PWA · Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) · Leaflet + OpenStreetMap.

## Run it

```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (+ server-only keys for scripts)
npm run dev                  # http://localhost:5173, also on your LAN for phone testing
npm test                     # unit tests (state machine, geo / girls' protocol)
```

### Database

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push --remote --include-seed   # migrations + safe point seed
npm run seed:users                             # 6 demo accounts (spec section 4)
npm run check:rls                              # live RLS smoke checks
npx supabase functions deploy --use-api        # all edge functions (tick runs without JWT, see config.toml)
```

Function secrets (set once, in the Supabase dashboard or `npx supabase secrets set …`):
`DEMO_MODE=true` (phone code 123456 + demo reset), `DEMO_TIME_SCALE=60` (1 real minute = 1 hour for escalation),
and for real AI: `AI_BASE_URL`, `AI_API_KEY`, `AI_STT_MODEL`, `AI_LLM_MODEL`. Without AI keys everything still
works: extraction falls back to keyword rules (R6, fail open).

WhatsApp alerts (Twilio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (e.g. `whatsapp:+14155238886`
for the sandbox). Police numbers live in `app_settings.police_whatsapp`, and the link base in `app_settings.app_url`.
Without the Twilio secrets, messages are only written to the audit log (`notify.whatsapp`).

### Testing against the live project

```bash
npm test                 # unit: state machine, matching, keyword extraction, girls' protocol
npm run smoke:p1         # finder -> safe point custody, girls' protocol, police record
npm run smoke:flow       # full story: check-in, found child, AI, match, confirm, masked chat, handover, failure path, escalation
npm run demo:scenario    # seeds a match waiting for the finder's decision (for a live demo)
npm run demo:reset       # wipes cases/audit/media (or use "Reset demo" in /admin)
```

## How it works

```
finder report ──► create-case (case + police record + audit, one transaction)
                    └─► background: transcribe → extract (LLM | keywords) → match
safe point accepts ──► match_suggested (both sides) ──► finder/staff confirm on the PARENT's photo
                    ──► masked chat ──► staff checklist ──► reunited | handover_blocked (police URGENT)
tick (pg_cron, every minute): escalation to police, check-in expiry, ZARRA flag, retention flags
```

Every status change goes through `supabase/functions/_shared/state.ts` (`transition()`), which also
updates the police record and writes the audit log.

## Routes

| Route | Who |
|---|---|
| `/f` | Finder (found a child) |
| `/p` | Parent / guardian |
| `/checkin` | Gate check-in ("Aaj ki Tasveer") |
| `/sp` | Safe point staff |
| `/admin` | Control room |
| `/police` | Police (simulated) |

## Ground rules

No public posts. Parents never see the found child's photo or location. AI suggests, humans decide. Girls go only to women-staffed safe points. A safe point always sits between finder and parent. Police are always informed. Everything is audited. See spec sections 2 and 19.

## Credits

Map data © OpenStreetMap contributors, rendered with Leaflet. Icons: Lucide.
