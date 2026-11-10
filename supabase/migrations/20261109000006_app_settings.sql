-- Non-secret runtime switches (demo mode, time scale) live in the database so they can be changed
-- without redeploying functions. A function secret of the same name (DEMO_MODE / DEMO_TIME_SCALE)
-- always wins, so production can force DEMO_MODE=false. RLS on, no policies: service role only.
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

insert into public.app_settings (key, value) values
  ('demo_mode', 'true'),
  ('demo_time_scale', '60')
on conflict (key) do nothing;
