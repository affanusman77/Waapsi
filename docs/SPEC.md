# Wapsi: Build Spec for Claude Code
> Lost-child (and lost-family-member) reunion platform · FAST TechSoc AI Hackathon 2026 · Theme: *AI with Purpose: Building Better Societies*
> Working name **Wapsi** (واپسی). Alternative: **Amaan** as the platform name, with "Wapsi" as the reunion flow. **All user-facing names live in `src/config/brand.ts`**, so renaming means editing one file.
> Tagline: *"Har bacha ghar wapas."*

---

## 0. How to use this file with Claude Code

1. Create a **fresh repo after the Day 1, 09:00 kickoff** (hackathon originality rule). Put this file at `docs/SPEC.md`.
2. Build **one phase at a time** (section 12). Prompt template:
   > Read `docs/SPEC.md`. Implement **Phase N only**. Follow sections 2 (rules), 5 (data), and 8 (UI). Run the tests, show me what changed, then stop.
3. After each phase: test it by hand on a phone, commit, and start a **new Claude Code session** for the next phase to save tokens.
4. Never let Claude Code skip section 2. Those rules are what judges will check you on.

---

## 1. Product in one paragraph

A **finder** (a shopkeeper or passer-by) who finds a lost child opens a web link, verifies their phone, and sends a photo, a voice note (Urdu/Punjabi/Saraiki) and their location in about 30 seconds. AI turns the voice note into a structured case. The child waits at the nearest **safe point**. A **police record** is created immediately. A **parent** reports a missing child, or did a **gate check-in** ("Aaj ki Tasveer") earlier. AI **matches** the reports and explains why. The **finder confirms** against the parent's photo, a private chat opens, and the **safe point verifies the handover**. The case closes as **"Reunited"** and the police record updates. If there's no match within 60 minutes, police take over. If verification fails, the child is not handed over and police are called.

---

## 2. Non-negotiable rules (enforce in code, RLS and UI)

| # | Rule | Enforcement |
|---|---|---|
| R1 | **No public posts.** Child photos and locations are never public. | Storage buckets private; signed URLs only; RLS on every table |
| R2 | **Photo direction.** The parent **never** sees the found child's photo or exact location. The **finder** sees the **parent's** photo of the child after a match is suggested. | RLS plus a `match_view` per role; test this (section 11) |
| R3 | **Humans decide, AI suggests.** No match becomes a reunion without (a) the finder confirming and (b) the safe point verifying. | State machine (section 6) blocks skipping steps |
| R4 | **Girls' protocol.** If `gender = female`, she goes only to safe points where `women_staff = true`, and the handover requires a female staff member to tick "present". | Safe point filter plus checklist validation |
| R5 | **Police always informed, never a bottleneck.** A police record is created when the case is created; police take over at 60 minutes or on failed verification. | `police_records` insert in the same transaction; `tick` function |
| R6 | **Fail open.** If an AI call fails, the report is still saved (typed text plus keyword rules). | try/catch, `ai_status` field, fallback extractor |
| R7 | **Everything audited.** Every AI suggestion, human decision and system event is logged. | `audit_log` insert helper used everywhere |
| R8 | **Masked contact.** Phone numbers are never shown between finder and parent. | Chat only; no phone fields in client views |
| R9 | **Data expiry.** Check-ins expire after 48 hours; closed cases are flagged for deletion after 7 days (just show the policy in the MVP). | `expires_at` columns plus `tick` cleanup |

---

## 3. Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind, React Router, PWA (vite-plugin-pwa), Leaflet + OpenStreetMap tiles |
| Backend | Supabase: Postgres, Auth (phone OTP), Storage, Realtime, Edge Functions (Deno), pg_cron |
| Speech-to-text | Whisper large-v3 via OpenAI-compatible API (Groq recommended). Use `language: "ur"` or auto. **Saraiki isn't an official Whisper language**, so it transcribes roughly as Urdu/Punjabi and the LLM normalises it. |
| LLM | OpenAI-compatible chat model with JSON output (extraction, guided questions, announcements, event report) |
| Vision | Vision-capable model on the same API (wrist number OCR) |
| TTS | `TTS_PROVIDER` env setting: OpenAI TTS or Google Cloud TTS (`ur-PK`/`ur-IN`). Fallback: show the text plus browser `speechSynthesis`. |
| Deploy | Frontend on Vercel (HTTPS is required for the mic and location on phones). Supabase hosted. |

**Env vars** (`.env.example`, never committed with values):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
AI_BASE_URL=            # e.g. https://api.groq.com/openai/v1
AI_API_KEY=
AI_STT_MODEL=whisper-large-v3
AI_LLM_MODEL=
AI_VISION_MODEL=
TTS_PROVIDER=openai|google|browser
TTS_API_KEY=
DEMO_MODE=true          # demo OTP, time scaling, seed data
DEMO_TIME_SCALE=60      # 60 = 1 real minute counts as 1 hour (escalation demo)
```

---

## 4. Roles and routes

| Role | Route | Device |
|---|---|---|
| Finder | `/f` | Any phone browser, no install |
| Parent / guardian | `/p` | Phone |
| Gate check-in | `/checkin` (QR at the event gate) | Phone |
| Safe point staff | `/sp` | Phone or tablet |
| Admin / event control room | `/admin` | Laptop (big screen in the demo) |
| Police (simulated) | `/police` | Laptop |

**Auth:** phone OTP. Use **Supabase test phone numbers** with a fixed OTP for the demo. If the project won't allow test numbers without an SMS provider, set `DEMO_MODE=true`: an edge function `demo-otp` accepts code `123456`, creates or signs in the user via anonymous sign-in, and stores `phone` plus `role` in `profiles`.

Demo accounts:
| Phone | Role |
|---|---|
| +923000000001 | finder |
| +923000000002 | parent |
| +923000000003 | safe point staff (female, Behan Desk) |
| +923000000004 | safe point staff (male) |
| +923000000005 | admin |
| +923000000006 | police |

---

## 5. Data model (Supabase migrations)

```sql
-- enums
create type user_role as enum ('finder','parent','sp_staff','admin','police');
create type case_kind as enum ('found','lost','checkin');
create type case_status as enum (
  'reported','at_safe_point','matched','finder_confirmed','verifying',
  'reunited','escalated_police','handover_blocked','closed_no_match','expired');
create type match_status as enum ('suggested','finder_confirmed','finder_rejected','reunited','blocked');
create type actor_type as enum ('human','ai','system');

create table profiles (
  id uuid primary key references auth.users,
  phone text unique not null,
  role user_role not null,
  display_name text,
  gender text check (gender in ('male','female')),   -- needed for R4 staff check
  safe_point_id uuid,                                 -- for sp_staff
  created_at timestamptz default now()
);

create table safe_points (
  id uuid primary key default gen_random_uuid(),
  name_en text, name_ur text,
  kind text,                 -- shop | mosque | edhi | police_desk | event_desk
  lat double precision, lng double precision,
  women_staff boolean default false,   -- "Behan Desk"
  active boolean default true
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  kind case_kind not null,
  status case_status not null default 'reported',
  reporter_id uuid references profiles(id),
  -- extracted / entered details
  child_name text, child_name_norm text,
  father_name text, father_name_norm text,
  age_est int, gender text,
  clothing jsonb,           -- {top_color, top_type, bottom_color, bottom_type, other:[]}
  languages text[],         -- what the child speaks
  notes text,
  -- media (private storage paths)
  photo_path text, wrist_photo_path text, voice_path text,
  transcript text, ai_extract jsonb, ai_status text default 'pending', -- ok | failed | fallback
  -- place & time
  lat double precision, lng double precision,
  seen_at timestamptz not null default now(),  -- found time or last-seen time
  safe_point_id uuid references safe_points(id),
  -- control
  escalate_at timestamptz,
  expires_at timestamptz,   -- check-ins: now()+48h
  flags text[] default '{}',
  created_at timestamptz default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  found_case_id uuid references cases(id),
  lost_case_id uuid references cases(id),
  score numeric, reasons jsonb,   -- [{factor, score, text_en, text_ur}]
  via text default 'ai',          -- ai | wrist_number
  status match_status default 'suggested',
  created_at timestamptz default now(),
  unique(found_case_id, lost_case_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id),
  sender_id uuid references profiles(id),
  body text, created_at timestamptz default now()
);

create table handovers (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id),
  staff_id uuid references profiles(id),
  checklist jsonb,  -- {gallery_photo_match, b_form_seen, child_reaction_ok, finder_confirmed, female_staff_present}
  result text check (result in ('verified','failed')),
  reason text, created_at timestamptz default now()
);

create table police_records (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id),
  station text,
  status text,     -- 'Record only' | 'Active takeover' | 'URGENT: verification failed' | 'Reunited'
  updated_at timestamptz default now()
);

create table audit_log (
  id bigserial primary key,
  case_id uuid, match_id uuid,
  actor_id uuid, actor actor_type not null,
  action text not null,     -- e.g. 'case.created','ai.extracted','match.suggested','finder.confirmed','handover.failed'
  payload jsonb, created_at timestamptz default now()
);
```

**Storage buckets** (all private): `case-photos`, `wrist-photos`, `voice-notes`, `announcements`.

**RLS summary** (write real policies and test them):
- `cases`: reporters read their own. sp_staff read cases at their safe point. admin/police read all. A parent may read **only** their own lost/checkin cases.
- Found-case `photo_path`, `lat`, `lng` are **never** returned to the parent. Use the view `parent_match_view` that exposes only `match.status`, the safe point name **after** `finder_confirmed`, and chat access.
- Finder reads `finder_match_view`: includes a **signed URL of the lost case photo** (R2).
- `messages`: only the two match parties plus admin.
- `audit_log`, `police_records`: admin/police read; inserts only via service role (edge functions).

---

## 6. State machine (single source of truth: `supabase/functions/_shared/state.ts`)

**Found case**
```
reported ──(safe point chosen)──► at_safe_point ──(match suggested)──► matched
matched ──(finder confirms photo)──► finder_confirmed ──(staff opens checklist)──► verifying
verifying ──verified──► reunited          (police_records → 'Reunited')
verifying ──failed────► handover_blocked  (police → 'URGENT', UI red, child stays)
any non-final ──(now > escalate_at)──► escalated_police (police → 'Active takeover'; matching continues)
escalated_police ──(match + verify still possible)──► reunited
```
**Lost case:** `reported → matched → finder_confirmed → verifying → reunited | handover_blocked`; no match after 2 scaled hours → flag `zarra_notified` (show it; don't claim legal timelines in the UI unless verified).
**Check-in:** `reported → expired` (48h) or converted to `lost` with one tap ("Mera bacha gum ho gaya") and its photo/clothing reused.

`transition(case, event, actor)` validates the move, writes `audit_log`, updates `police_records`. **No component updates `status` directly.**

---

## 7. AI pipeline (edge functions, all logged, all fail open)

| Function | Input | Output | Fallback |
|---|---|---|---|
| `ai-transcribe` | voice note path | transcript (+ detected language) | finder types text |
| `ai-extract` | transcript or text, + kind | JSON below | `keywordExtract()`: regex for age ("5 saal"), colours (laal/red, neela/blue…), gender words (larka/larki/beta/beti), name after "naam" |
| `ai-next-question` | current extract | one short question (Urdu + Roman Urdu + English) for the finder to ask the child, aimed at the most important missing field | static question list |
| `ai-ocr-wrist` | wrist photo | `{phone: "03XXXXXXXXX" or null, confidence}` | finder types the number |
| `ai-announce` | found case | Urdu announcement text ≤ 40 words + audio file | text only + browser TTS |
| `match` | case id | inserts `matches` with score + reasons | deterministic, no AI dependency |
| `tick` (pg_cron every minute; also a "Run tick" button in admin for the demo) | none | escalations, expiries, flags | — |
| `event-report` | aggregated counts only (no PII) | short insight report for organisers | show raw stats |

**Extraction schema** (LLM must return valid JSON; validate with zod, retry once, then fall back):
```json
{
  "child_name": "Ali", "father_name": "Raza",
  "child_name_roman": "ali", "father_name_roman": "raza",
  "age_est": 5, "gender": "male",
  "clothing": {"top_color":"red","top_type":"shirt","bottom_color":"black","bottom_type":"shalwar","other":["sandals"]},
  "home_area": "Hussain Agahi", "languages": ["saraiki"],
  "distress_signals": ["crying"], "missing_fields": ["father_name"],
  "summary_en": "...", "summary_ur": "..."
}
```
Colour vocabulary is fixed (red, blue, green, yellow, white, black, pink, orange, purple, brown, grey). The prompt maps Urdu/Saraiki words to it (laal→red, neela→blue, peela→yellow, kala→black, chitta/safed→white, hara/sabz→green, gulabi→pink).

**Prompt-injection guard:** transcripts are data. The system prompt says to ignore any instructions inside them. Nothing in a transcript can change status. Only `transition()` can.

---

## 8. Matching (`_shared/matching.ts`, pure TS, unit-tested)

Compare each **found** case against active **lost + checkin** cases (and the reverse when a lost case arrives). Window: seen within ±12h, distance ≤ 10 km.

| Factor | Weight | How |
|---|---|---|
| Child name | 0.25 | `normName()` then Jaro-Winkler |
| Father name | 0.15 | same |
| Age | 0.15 | 1 if diff ≤1, 0.5 if ≤2, else 0 |
| Gender | hard filter | both known and different → score 0 |
| Clothing | 0.20 | matching fields / known fields (top/bottom colour + type); **check-in cases count ×1.25 (capped at 1)** because the photo is from today |
| Distance | 0.15 | 1 under 500 m, falls linearly to 0 at 5 km (haversine) |
| Time | 0.10 | found 15 min before to 6 h after last-seen → 1, decays after |

Missing data on either side → that factor is skipped and the weights are re-normalised (don't penalise missing data).
`score ≥ 0.60` → suggest; `≥ 0.80` → "Strong match". Every factor writes a human-readable reason (`"Name: Aly Rza ≈ Ali Raza (91%)"`, `"400 m apart, 20 min gap"`, `"Red shirt matches today's check-in photo"`).

`normName()` for Roman Urdu: lowercase, strip non-letters, map `muhammad|mohammad|muhammed|mohd|md → mhmd`, `ee→i`, `oo→u`, `y→i` (word-internal), `w→u` after consonants, collapse double letters, drop a trailing `h`. Unit-test: `Aly Rza ≈ Ali Raza`, `Mohd Usman ≈ Muhammad Usman`, `Zainab ≠ Zubair`.

**Wrist-number shortcut:** if `ai-ocr-wrist` returns a valid `03\d{9}` that belongs to a registered parent with an open lost/checkin case → create match `via='wrist_number'`, score 1.0, reason "Number written on wrist". If the number isn't registered: log "Message sent to 03xx-xxxx-x12 (simulated)" and show it to the admin.

**Face check (added 2026-11-11, F4):** Amazon Rekognition, run ONCE per newly suggested match (found-child photo vs the family photo; no face database). Unclear photos are never compared: the finder/staff are told which photo and why (no face, several faces, too small, blurry, too dark/bright, turned away). Result = a hint line (alike >= 90%, some resemblance >= 75%, else not alike), never part of the score, never shown to the parent. Code: `_shared/face.ts` (pure, tested) + `_shared/face-check.ts`.

---

## 9. Screens (one action per screen, voice-first, Urdu/English toggle)

### Finder `/f`
1. **Phone + OTP.** One big field.
2. **Child photo.** Camera opens directly. Optional second button: "📷 Number on the wrist?" (wrist photo, then OCR runs in the background).
3. **Voice note.** Big hold-to-record mic: "Batayein kya hua, bacha kya keh raha hai." There's a "Type instead" link.
4. **Location.** Auto GPS, with a map pin you can drag.
5. **Case card.** AI summary (Urdu + English), extracted fields as editable chips, **"Bachay se poochein: …"** guided-question card (record the answer, then fields re-extract).
6. **Go to safe point.** Nearest safe point on the map plus walking distance. **If the child is a girl → only Behan Desk points.** Button: "I'm at the safe point" → `at_safe_point`.
7. **Match screen** (realtime): parent's photo of the child plus match reasons. Buttons: **"Haan, yehi bacha hai"** / **"Nahi"**. Yes opens the chat.

### Parent `/p`
1. Phone + OTP.
2. Choose **"Mera bacha gum hai"** or **"Status dekhein"**.
3. Photo from **own gallery**, voice note, last-seen point on the map plus time ("kitni dair pehle"), optional route description.
4. **Status tracker** (realtime): Searching → Possible match (no photo, no location) → Finder confirmed → "Go to [safe point name]" → Reunited. Chat with the finder once confirmed.

### Gate check-in `/checkin` ("Aaj ki Tasveer")
QR on the standee → OTP → one photo in today's clothes → child's first name + age → done ("Auto-deletes in 48 hours"). Shows a reminder: "Bachay ki kalai par apna number likhein." If the child gets lost, one tap turns it into a lost report.

### Safe point `/sp`
- Incoming children (cards: summary, time waiting, escalation countdown).
- **Handover checklist:** parent's gallery photo matches the child · B-form seen (optional) · child's reaction OK · finder confirmed · **female staff present (required for girls)**. Buttons: **Verify handover** (green) / **Something's wrong** (red → `handover_blocked`).
- **Play announcement** (from `ai-announce`).

### Admin / control room `/admin` (big screen)
- Live map: cases by status colour, safe points (Behan Desk icon), counts.
- **Reunion timer** on each case: created → reunited. The latest reunion shows large ("2 min 41 sec").
- Escalation countdowns, **abuse flags** panel, live audit log feed.
- Safe point list and load; "Run tick" button (demo); "Generate event report" (AI insights from aggregates).
- Demo controls (only if `DEMO_MODE`): reset demo data, time-scale indicator.

### Police `/police` (simulated)
Table of police records with status chips (Record only / Active takeover / **URGENT** / Reunited), nearest station name, case summary (no photo by default; tap to reveal with an audit entry). Header: **"Simulated police endpoint: the real integration is a partner step."**

---

## 10. Abuse flags (rules in `tick` + on insert; show in admin, never auto-punish)

- Same phone filed **>2 lost reports in 24h** → `multi_claim`
- Same finder filed **>2 found reports in 24h** → `frequent_finder`
- Lost report with **<3 known fields** that reaches handover within **10 min** → `low_detail_fast_claim`
- **Any failed verification** → `verification_failed` on the parent's profile
- Chat message containing a phone number pattern → masked automatically, `contact_share_attempt`

---

## 11. Tests (Claude Code must write and run these)

- `matching.test.ts`: name normalisation cases, gender filter, weight re-normalisation, wrist shortcut, the threshold boundaries.
- `state.test.ts`: every allowed transition; every forbidden one throws (e.g. `matched → reunited` directly).
- `keywordExtract.test.ts`: "5 saal ka larka laal shirt naam Ali" → age 5, male, red, Ali.
- `rls.test.ts` (against the local Supabase): parent session **cannot** read the found-case `photo_path`/`lat`/`lng`; finder **can** read the lost-case photo URL only after a match.
- Girls' protocol: `nearestSafePoints(gender='female')` returns only `women_staff = true`; handover without `female_staff_present` is rejected.

---

## 12. Build phases (2 days)

> Mystery Card reveal: **Day 2, 13:00**. Keep Phase 7 free for it.

| Phase | When | Build | Done when |
|---|---|---|---|
| **P0 Setup** | D1 09:30–10:30 | Vite + TS + Tailwind + router + PWA, `brand.ts`, i18n (en/ur, RTL), Supabase migrations, buckets, RLS skeleton, seed safe points + demo users, `audit()` helper, `transition()` stub | `npm run dev` shows the route stubs; seed visible on the admin map |
| **P1 Finder core** | D1 10:30–13:00 | Finder screens 1–4 + 6, uploads, case created + police record + audit, nearest safe point (girls rule) | A case appears in admin and police within 2 s (realtime) |
| **P2 AI pipeline** | D1 14:00–16:30 | `ai-transcribe`, `ai-extract` + zod + fallback, `ai-next-question`, case card screen 5 | A Saraiki/Urdu voice note becomes correct chips; with the AI key removed, keyword fallback still saves the case |
| **P3 Parent + check-in + matching** | D1 16:30–20:00 | Parent flow, check-in flow, `match` function + `matching.ts` + tests, realtime status tracker | "Aly Rza, 5, laal shirt" matches the found "Ali Raza" with reasons, score ≥ 0.8 |
| **P4 Confirm → chat → handover** | D1 20:00–23:00 | Finder match screen (R2 views), masked chat, safe point dashboard + checklist + girls rule, `reunited` / `handover_blocked` | Full happy path and the blocked path both work on two phones |
| **P5 Police, escalation, admin** | D2 09:00–11:30 | `tick` (pg_cron + button), time scaling, police panel, admin control room, audit feed, abuse flags | With time scale 60, an unmatched case escalates in 1 real minute |

> **Status (2026-11-09):** P0–P5 done, plus F1, F2, R10–R12. P6 changed: wrist OCR and `ai-announce` are dropped (see W1 in section 19); WhatsApp (F3) takes their place. The reunion timer + "Reunited" animation are done.
| **P6 Wow features** | D2 11:30–13:00 | Wrist OCR shortcut, `ai-announce` + audio, reunion timer + "Reunited" animation | Wrist photo → match in under 60 s; announcement plays |
| **P7 Mystery Card** | D2 13:00–17:00 | Implement the card as a new module behind a feature flag (`src/features/<card>/`); log it in the audit trail; show it in the admin | Card feature demoed end to end |
| **P8 Polish + submission** | D2 17:00–end | Demo reset button, seed demo story, empty/error states, Lighthouse mobile pass, README, MVP document, backup demo video, ethics one-pager | Fresh device can run the full demo from the QR code |

**Mystery Card readiness (design for it from P0):** keep these steps separate (`intake → ai → match → confirm → handover → police`), add features as new modules + flags, keep channels pluggable (`notify(channel, payload)` with `log` implemented and room for `sms`/`whatsapp`), keep i18n strings in one place.

---

## 13. Design system

- **Mood:** calm, steady, human. "Someone steady has taken over."
- **Colours** (put them in `brand.ts` and the Tailwind theme): warm cream background, deep ink text, **terracotta** primary action (Yume warmth), calm **teal/green** for "Reunited", **red only** for escalation, police and blocked states, soft sand for cards.
- **Type:** Noto Nastaliq Urdu (Urdu), Plus Jakarta Sans or Inter (English). Urdu body ≥ 18px.
- **Touch:** buttons ≥ 56px tall, full width on mobile, icons on every primary action, minimal typing, voice everywhere.
- **One action per screen**, progress dots at the top, back always available.
- **"Reunited" moment:** soft warm glow plus a tick, the timer freezes, the police chip turns green. Design it on purpose; it's the demo climax.
- Every screen works at 360px width on a cheap Android.

---

## 14. Seed data (demo only; coordinates are approximate)

Safe points around Multan's old city / shrine area:
| Name | Kind | Behan Desk | lat, lng |
|---|---|---|---|
| Shrine Gate Event Desk | event_desk | ✅ | 30.2002, 71.4690 |
| Ghanta Ghar Help Desk | police_desk | ❌ | 30.1978, 71.4698 |
| Hussain Agahi Shop #12 | shop | ❌ | 30.1962, 71.4738 |
| Edhi Centre (demo) | edhi | ✅ | 30.1940, 71.4655 |
| Masjid Help Point | mosque | ❌ | 30.1990, 71.4720 |

**Demo story seed:** one check-in (boy, ~5, red shirt, "Ali", parent +923000000002), one older unmatched found case (for the escalation demo), one flagged suspicious claim.

---

## 15. Demo script (3 minutes, the build must support every beat)

1. **Hook (20s):** a real voice clip of a parent's or shopkeeper's story, then: "Today the system is a mosque loudspeaker."
2. **Judge as finder (60s):** the judge scans the standee QR, records "Ye bacha mila hai, naam Ali bata raha, abu ka naam Raza, Hussain Agahi ke paas." The case card appears on the big screen; the police panel lights up "Record only".
3. **Match (40s):** the parent's check-in matches at 91% with reasons. The finder confirms the parent's photo. The safe point checklist runs. **"Reunited · 2 min 41 sec."** Police chip turns green.
4. **Wrist number (20s):** wrist photo → match in seconds.
5. **Failure path (20s):** "Something's wrong" → red, police URGENT, child stays.
6. **Mystery Card (20s).**
7. **Close:** a safe point partner, the pilot plan, *"Har bacha ghar wapas."*

---

## 16. Repo structure

```
/docs/SPEC.md  /docs/MVP_DOCUMENT.md  /docs/ETHICS.md
/src
  /config/brand.ts  /i18n/{en,ur}.json
  /routes/{finder,parent,checkin,safepoint,admin,police}/
  /components/  /lib/{supabase,audit,notify,geo}.ts
  /features/    # mystery card + flagged features
/supabase
  /migrations/  /seed.sql
  /functions/_shared/{matching,state,extract-fallback,prompts}.ts
  /functions/{ai-transcribe,ai-extract,ai-next-question,ai-ocr-wrist,ai-announce,match,tick,event-report,demo-otp}/
/tests/
README.md  .env.example
```

---

## 17. Submission checklist (from the participant guide)

- [ ] Project title + description (problem, solution, how it works)
- [ ] Working MVP, live demo ready (+ backup video)
- [ ] Mystery Card: which card, how it was implemented
- [ ] MVP Document in the organisers' example format (`docs/MVP_DOCUMENT.md`)
- [ ] GitHub repo URL with all files; **no API keys committed**
- [ ] Credits: Leaflet, OpenStreetMap, model providers

## 18. Before the event (no code, allowed prep)

- [ ] Get one real safe point "yes" (Edhi Multan / urs committee / a shop)
- [ ] Record 2–3 real lost-child stories (with permission)
- [ ] Check the legal claims (FIR timelines, ZARRA process) before saying them on stage
- [ ] Print the QR standee ("Bacha mila? Scan karein")
- [ ] Practise the hard judge questions: why not 15, the PSCA app, predators posing as parents, fake reports, AI accuracy

---

## 19. Team additions (added 2026-11-09, during P0)

| # | Requirement | Design | Phase |
|---|---|---|---|
| R10 | **Safe point always sits between finder and parent, and must accept the child.** The case only counts as "in safe custody" when safe point staff accept it. | New status `awaiting_safe_point` (finder walking). New event `safe_point_accepted` (sp_staff only) → `at_safe_point`; police record → "In safe custody". Matching for found cases only starts after acceptance. *(Already in `state.ts` + migration.)* | P0 (state), P1 (finder/sp screens) |
| R11 | **Children under 4 go through the safe point only.** Very young children can't confirm who their parent is, so the safe point does every step. | If `age_est < 4` (or the finder ticks "can't speak yet"): finder must hand over to a safe point (no "wait here with the child" option). The **safe point staff**, not the finder, do the photo confirmation and the parent chat. Finder gets a thank-you and can leave. Handover checklist requires the parent's gallery photo + B-form. | P1 (finder rule), P4 (sp confirm/chat) |
| R12 | **Police connected at every step until handover.** | `police_records.status` follows every custody step: Record only → In safe custody → Active takeover / URGENT / Reunited. The police panel shows the full audit timeline per case, including which safe point holds the child. | P1 + P5 |
| F1 | **Parent account with a saved child photo (prevention).** Parents can register and save their child's photo and details *before* anything happens. If the child gets lost, one tap turns the profile into a lost report. | Table `children` (parent-owned, RLS: owner only) + private bucket `child-profiles`. Not public, never matched until a lost report is filed from it. Kept until the parent deletes it (unlike check-ins, R9). Explicit consent checkbox stored as `consent_at`. | P3 |
| F2 | **Safe point onboarding.** We create and manage safe points (not just seeded). | Admin screen to add/edit/deactivate safe points, set `women_staff`, assign staff phones. | P5 |
| F3 | **WhatsApp integration.** | **Twilio WhatsApp sandbox** for the demo (Meta business verification takes days). Code: `supabase/functions/_shared/whatsapp.ts`. **Outbound (built):** police get every new found/lost case and every police status change (R12); safe point staff get "a child is being brought to you" when a finder picks their safe point (R10); parents get "possible match" and "reunited". Urdu + English text, a landmark instead of coordinates, never a photo (R1/R2). Every message is audited with a masked number; with no `TWILIO_*` secrets messages are simulated (audit only). Police numbers: `app_settings.police_whatsapp`. **Inbound (planned):** a finder reports by WhatsApp: photo → voice note → shared location → pick a safe point from a numbered list. Webhook function `whatsapp-webhook` (Twilio signature check), conversation state in a `wa_sessions` table, reuses `create-case` + the AI pipeline. The WhatsApp number counts as the verified phone. Match confirmation for WhatsApp reports is done by safe point staff (as for under-4s, R11). | Outbound done; inbound next |
| W1 | **Wrist number: advice only (2026-11-09).** Wrist OCR and AI announcements are dropped. | The app tells parents "Write your phone number on your child's wrist" (check-in, status, saved children). The finder flow no longer takes a wrist photo. | Done |
| F4 | **Face check on suggested matches (2026-11-11).** | AWS Rekognition DetectFaces (quality gate) + CompareFaces, only after a match is suggested; unclear photo = skipped with the reason shown; stored as the `face` reason on the match; hint only. Secrets: `REKOGNITION_ACCESS_KEY_ID`, `REKOGNITION_SECRET_ACCESS_KEY`, `REKOGNITION_REGION`. Off (nothing shown) without them. | Done |
