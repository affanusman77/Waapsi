-- Private storage buckets (R1). No storage policies yet = no client access at all;
-- uploads and signed URLs go through edge functions until per-role policies land in P1/P4.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('case-photos', 'case-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('wrist-photos', 'wrist-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('voice-notes', 'voice-notes', false, 10485760, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']),
  ('announcements', 'announcements', false, 10485760, array['audio/mpeg', 'audio/ogg', 'audio/wav']),
  ('child-profiles', 'child-profiles', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false;
