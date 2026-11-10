-- Row level security (R1, R2, R7, R8). RLS is ON for every table; no policy = no access.
-- Writes to cases/matches/handovers/police_records/audit_log go through edge functions
-- (service role) so the state machine (state.ts) is the only path that changes status.

-- Helpers live in a schema PostgREST doesn't expose, so they can't be called as RPCs.
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create or replace function private.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function private.my_safe_point() returns uuid
language sql stable security definer set search_path = '' as $$
  select safe_point_id from public.profiles where id = auth.uid()
$$;

create or replace function private.is_control() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('admin', 'police') from public.profiles where id = auth.uid()), false)
$$;

revoke all on function private.my_role(), private.my_safe_point(), private.is_control() from public;
grant execute on function private.my_role(), private.my_safe_point(), private.is_control() to anon, authenticated;

alter table public.safe_points enable row level security;
alter table public.profiles enable row level security;
alter table public.children enable row level security;
alter table public.cases enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.handovers enable row level security;
alter table public.police_records enable row level security;
alter table public.audit_log enable row level security;

-- safe_points: public help locations (a mosque desk is not secret); admin manages them (F2).
create policy safe_points_read on public.safe_points for select to anon, authenticated
  using (active or (select private.my_role()) = 'admin');
create policy safe_points_admin_write on public.safe_points for all to authenticated
  using ((select private.my_role()) = 'admin') with check ((select private.my_role()) = 'admin');

-- profiles: you read yourself; admin/police read everyone. Created by the demo-otp function (service role).
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_control()));

-- children (F1): strictly owner-only. Not even admin/police browse saved profiles.
create policy children_owner_read on public.children for select to authenticated
  using (parent_id = (select auth.uid()));
create policy children_owner_insert on public.children for insert to authenticated
  with check (parent_id = (select auth.uid()) and consent_at is not null);
create policy children_owner_update on public.children for update to authenticated
  using (parent_id = (select auth.uid())) with check (parent_id = (select auth.uid()));
create policy children_owner_delete on public.children for delete to authenticated
  using (parent_id = (select auth.uid()));

-- cases: reporters read their own; staff read cases at their safe point; admin/police read all.
-- A parent never reads a FOUND case row (R2): they aren't its reporter. Match info reaches
-- parents only through parent_match_view (P3/P4), which hides photo_path/lat/lng.
create policy cases_read on public.cases for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or ((select private.my_role()) = 'sp_staff' and safe_point_id = (select private.my_safe_point()))
    or (select private.is_control())
  );

-- matches / handovers: control room only for now; party access comes via role views in P3/P4.
create policy matches_read on public.matches for select to authenticated
  using ((select private.is_control()));
create policy handovers_read on public.handovers for select to authenticated
  using ((select private.is_control()));

-- messages: admin only for now; the two match parties are added in P4.
create policy messages_admin_read on public.messages for select to authenticated
  using ((select private.my_role()) = 'admin');

-- police_records / audit_log: admin + police read; inserts ONLY via service role.
create policy police_records_read on public.police_records for select to authenticated
  using ((select private.is_control()));
create policy audit_log_read on public.audit_log for select to authenticated
  using ((select private.is_control()));
revoke insert, update, delete on public.police_records, public.audit_log from anon, authenticated;

-- Defense in depth: anon can't write anything.
revoke insert, update, delete on all tables in schema public from anon;

-- ---------- client audit RPC (R7) ----------
-- Humans log their own decisions; actor/actor_id are stamped server-side so they can't be forged.
create or replace function public.log_event(
  p_action text,
  p_case_id uuid default null,
  p_match_id uuid default null,
  p_payload jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_action !~ '^[a-z_]+(\.[a-z_]+)+$' or length(p_action) > 64 then
    raise exception 'invalid action name' using errcode = '22023';
  end if;
  if pg_column_size(p_payload) > 8192 then
    raise exception 'payload too large' using errcode = '22023';
  end if;
  insert into public.audit_log (case_id, match_id, actor_id, actor, action, payload)
  values (p_case_id, p_match_id, auth.uid(), 'human', p_action, coalesce(p_payload, '{}'));
end $$;

revoke all on function public.log_event(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.log_event(text, uuid, uuid, jsonb) to authenticated;
