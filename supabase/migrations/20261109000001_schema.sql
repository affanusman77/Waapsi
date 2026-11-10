-- Wapsi core schema (spec section 5 + section 19 additions).

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type public.user_role as enum ('finder', 'parent', 'sp_staff', 'admin', 'police');
create type public.case_kind as enum ('found', 'lost', 'checkin');
create type public.case_status as enum (
  'reported', 'awaiting_safe_point', 'at_safe_point', 'matched', 'finder_confirmed', 'verifying',
  'reunited', 'escalated_police', 'handover_blocked', 'closed_no_match', 'expired');
create type public.match_status as enum ('suggested', 'finder_confirmed', 'finder_rejected', 'reunited', 'blocked');
create type public.actor_type as enum ('human', 'ai', 'system');

-- ---------- safe points ----------
create table public.safe_points (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_ur text,
  kind text not null check (kind in ('shop', 'mosque', 'edhi', 'police_desk', 'event_desk')),
  lat double precision not null,
  lng double precision not null,
  women_staff boolean not null default false, -- "Behan Desk" (R4)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  phone text unique not null,
  role public.user_role not null,
  display_name text,
  gender text check (gender in ('male', 'female')), -- needed for R4 staff check
  safe_point_id uuid references public.safe_points (id), -- for sp_staff
  flags text[] not null default '{}', -- e.g. verification_failed (section 10)
  created_at timestamptz not null default now()
);
create index profiles_safe_point_idx on public.profiles (safe_point_id);

-- ---------- saved child profiles (F1: prevention) ----------
create table public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  name_norm text,
  birth_year int check (birth_year between 2000 and 2100),
  gender text check (gender in ('male', 'female')),
  photo_path text, -- private bucket child-profiles
  notes text,
  consent_at timestamptz not null, -- explicit parent consent to store the photo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index children_parent_idx on public.children (parent_id);

-- ---------- cases ----------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  kind public.case_kind not null,
  status public.case_status not null default 'reported',
  reporter_id uuid references public.profiles (id),
  child_id uuid references public.children (id) on delete set null, -- lost report filed from a saved profile
  -- extracted / entered details
  child_name text, child_name_norm text,
  father_name text, father_name_norm text,
  age_est int check (age_est between 0 and 18),
  gender text check (gender in ('male', 'female')),
  clothing jsonb, -- {top_color, top_type, bottom_color, bottom_type, other:[]}
  languages text[],
  notes text,
  -- media (private storage paths)
  photo_path text, wrist_photo_path text, voice_path text,
  transcript text, ai_extract jsonb,
  ai_status text not null default 'pending' check (ai_status in ('pending', 'ok', 'failed', 'fallback')),
  -- place & time
  lat double precision, lng double precision,
  seen_at timestamptz not null default now(), -- found time or last-seen time
  safe_point_id uuid references public.safe_points (id),
  -- control
  escalate_at timestamptz,
  expires_at timestamptz, -- check-ins: now()+48h (R9)
  flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cases_kind_status_idx on public.cases (kind, status);
create index cases_reporter_idx on public.cases (reporter_id);
create index cases_safe_point_idx on public.cases (safe_point_id);
create index cases_seen_at_idx on public.cases (seen_at);
create index cases_escalate_at_idx on public.cases (escalate_at) where escalate_at is not null;

-- ---------- matches ----------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  found_case_id uuid not null references public.cases (id) on delete cascade,
  lost_case_id uuid not null references public.cases (id) on delete cascade,
  score numeric not null check (score between 0 and 1),
  reasons jsonb not null default '[]', -- [{factor, score, text_en, text_ur}]
  via text not null default 'ai' check (via in ('ai', 'wrist_number')),
  status public.match_status not null default 'suggested',
  created_at timestamptz not null default now(),
  unique (found_case_id, lost_case_id)
);
create index matches_lost_idx on public.matches (lost_case_id);

-- ---------- messages (masked chat, R8) ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_match_idx on public.messages (match_id, created_at);

-- ---------- handovers ----------
create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  staff_id uuid not null references public.profiles (id),
  checklist jsonb not null, -- {gallery_photo_match, b_form_seen, child_reaction_ok, finder_confirmed, female_staff_present}
  result text not null check (result in ('verified', 'failed')),
  reason text,
  created_at timestamptz not null default now()
);
create index handovers_match_idx on public.handovers (match_id);

-- ---------- police records (R5, R12) ----------
create table public.police_records (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases (id) on delete cascade,
  station text,
  status text not null default 'Record only',
  updated_at timestamptz not null default now()
);

-- ---------- audit log (R7) ----------
create table public.audit_log (
  id bigserial primary key,
  case_id uuid,
  match_id uuid,
  actor_id uuid,
  actor public.actor_type not null,
  action text not null, -- e.g. 'case.created','ai.extracted','match.suggested'
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_case_idx on public.audit_log (case_id, created_at);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------- updated_at triggers ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger cases_touch before update on public.cases
  for each row execute function public.touch_updated_at();
create trigger children_touch before update on public.children
  for each row execute function public.touch_updated_at();
create trigger police_records_touch before update on public.police_records
  for each row execute function public.touch_updated_at();

-- ---------- realtime ----------
-- Realtime respects RLS, so each client only receives rows it may read.
alter publication supabase_realtime add table
  public.cases, public.matches, public.messages, public.police_records, public.audit_log, public.safe_points;
