-- P1: uploads + atomic case creation (R5: police record in the same transaction, R7: audited).

-- Uploads: a signed-in user may only WRITE into their own folder (<uid>/...). There is no
-- select policy, so nobody can list or download through the API; reads use signed URLs
-- minted by edge functions after a role check (R1, R2).
create policy uploads_own_folder on storage.objects for insert to authenticated
  with check (
    bucket_id in ('case-photos', 'wrist-photos', 'voice-notes', 'child-profiles')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Called only by edge functions (service role) after they have validated the caller.
create or replace function public.create_case_tx(
  p_reporter uuid,
  p_kind public.case_kind,
  p_fields jsonb,
  p_escalate_after interval
) returns public.cases
language plpgsql security definer set search_path = '' as $$
declare
  c public.cases;
begin
  insert into public.cases (
    kind, reporter_id, child_id, child_name, father_name, age_est, gender, notes, transcript,
    photo_path, wrist_photo_path, voice_path, lat, lng, seen_at, escalate_at, expires_at, flags, ai_status
  ) values (
    p_kind,
    p_reporter,
    nullif(p_fields ->> 'child_id', '')::uuid,
    nullif(p_fields ->> 'child_name', ''),
    nullif(p_fields ->> 'father_name', ''),
    nullif(p_fields ->> 'age_est', '')::int,
    nullif(p_fields ->> 'gender', ''),
    nullif(p_fields ->> 'notes', ''),
    nullif(p_fields ->> 'transcript', ''),
    nullif(p_fields ->> 'photo_path', ''),
    nullif(p_fields ->> 'wrist_photo_path', ''),
    nullif(p_fields ->> 'voice_path', ''),
    nullif(p_fields ->> 'lat', '')::double precision,
    nullif(p_fields ->> 'lng', '')::double precision,
    coalesce(nullif(p_fields ->> 'seen_at', '')::timestamptz, now()),
    case when p_kind = 'checkin' then null else now() + p_escalate_after end,
    case when p_kind = 'checkin' then now() + interval '48 hours' else null end,
    coalesce(array(select jsonb_array_elements_text(p_fields -> 'flags')), '{}'),
    'pending'
  ) returning * into c;

  insert into public.police_records (case_id, station, status)
  values (c.id, 'Multan City Police (simulated)', 'Record only');

  insert into public.audit_log (case_id, actor_id, actor, action, payload)
  values (c.id, p_reporter, 'human', 'case.created', jsonb_build_object('kind', p_kind));

  insert into public.audit_log (case_id, actor, action, payload)
  values (c.id, 'system', 'police.record_created', jsonb_build_object('status', 'Record only'));

  return c;
end $$;

revoke all on function public.create_case_tx(uuid, public.case_kind, jsonb, interval) from public, anon, authenticated;
grant execute on function public.create_case_tx(uuid, public.case_kind, jsonb, interval) to service_role;
