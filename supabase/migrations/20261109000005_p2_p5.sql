-- P2–P5: matching views (R2), chat access (R8), handovers, saved-profile photos (F1), reunion timer.

alter table public.cases add column if not exists reunited_at timestamptz;
create index if not exists matches_status_idx on public.matches (status);

-- ---------- F1: parents manage their own saved-child photos ----------
create policy child_profiles_read_own on storage.objects for select to authenticated
  using (bucket_id = 'child-profiles' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy child_profiles_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'child-profiles' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- who is a party to a match? ----------
-- finder (found reporter), parent (lost reporter), staff of the safe point holding the child, admin.
create or replace function private.is_match_party(p_match uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.matches m
    join public.cases f on f.id = m.found_case_id
    join public.cases l on l.id = m.lost_case_id
    where m.id = p_match
      and (
        f.reporter_id = auth.uid()
        or l.reporter_id = auth.uid()
        or (f.safe_point_id is not null and f.safe_point_id = private.my_safe_point()
            and private.my_role() = 'sp_staff')
        or private.my_role() = 'admin'
      )
  )
$$;
revoke all on function private.is_match_party(uuid) from public;
grant execute on function private.is_match_party(uuid) to authenticated;

-- Chat (R8): only the parties read it; messages are written by the send-message function,
-- which masks phone numbers. Chat only exists after the finder confirmed (enforced there).
drop policy if exists messages_admin_read on public.messages;
create policy messages_party_read on public.messages for select to authenticated
  using ((select private.is_match_party(match_id)));

-- Handovers: staff of that safe point + control room.
create policy handovers_staff_read on public.handovers for select to authenticated
  using ((select private.is_match_party(match_id)) and (select private.my_role()) in ('sp_staff', 'admin'));

-- ---------- R2: role-specific match views ----------
-- These views run with the owner's rights (no RLS), so each one filters on auth.uid() itself
-- and exposes ONLY the columns that role may see.

-- Parent: never the found child's photo or location. Safe point name only after the finder confirmed.
create or replace view public.parent_match_view with (security_barrier = true) as
select
  m.id as match_id,
  m.lost_case_id,
  m.status as match_status,
  m.created_at,
  case when m.status in ('finder_confirmed', 'reunited') then sp.name_en end as safe_point_name_en,
  case when m.status in ('finder_confirmed', 'reunited') then sp.name_ur end as safe_point_name_ur,
  case when m.status in ('finder_confirmed', 'reunited') then sp.lat end as safe_point_lat,
  case when m.status in ('finder_confirmed', 'reunited') then sp.lng end as safe_point_lng,
  f.status as found_status,
  f.reunited_at,
  f.created_at as found_at
from public.matches m
join public.cases l on l.id = m.lost_case_id
join public.cases f on f.id = m.found_case_id
left join public.safe_points sp on sp.id = f.safe_point_id
where l.reporter_id = auth.uid()
  and m.status <> 'finder_rejected';

-- Finder (or the safe point staff, who do every step for under-4s, R11): the parent's
-- description of the child + match reasons. The PHOTO comes from media-url (signed, 2 min).
create or replace view public.finder_match_view with (security_barrier = true) as
select
  m.id as match_id,
  m.found_case_id,
  m.lost_case_id,
  m.status as match_status,
  m.score,
  m.reasons,
  m.via,
  m.created_at,
  l.kind as lost_kind,
  l.child_name as lost_child_name,
  l.father_name as lost_father_name,
  l.age_est as lost_age_est,
  l.gender as lost_gender,
  l.clothing as lost_clothing,
  (l.photo_path is not null) as lost_has_photo,
  ('under_4' = any (f.flags)) as under_4
from public.matches m
join public.cases f on f.id = m.found_case_id
join public.cases l on l.id = m.lost_case_id
where m.status <> 'finder_rejected'
  and (
    (f.reporter_id = auth.uid() and not ('under_4' = any (f.flags)))
    or (private.my_role() = 'sp_staff' and f.safe_point_id = private.my_safe_point())
    or private.my_role() = 'admin'
  );

revoke all on public.parent_match_view, public.finder_match_view from anon;
grant select on public.parent_match_view, public.finder_match_view to authenticated;

-- ---------- P5: scheduler ----------
-- tick is idempotent (it only acts on overdue items) and deployed without JWT verification,
-- so the cron job needs no key. The admin screen also has a "Run tick" button.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
grant usage on schema cron to postgres;

select cron.unschedule(jobid) from cron.job where jobname = 'wapsi-tick';
select cron.schedule(
  'wapsi-tick',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://ryufjagukhdntzsnrvyg.supabase.co/functions/v1/tick',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"source": "cron"}'::jsonb
     ) $$
);
