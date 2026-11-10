-- Demo seed (spec section 14). Coordinates are approximate, around Multan's old city / shrine area.
-- Idempotent: safe to run more than once. Demo USERS are created by scripts/seed-users.mjs
-- (they need auth.users rows, which must go through the Auth admin API).

insert into public.safe_points (id, name_en, name_ur, kind, lat, lng, women_staff) values
  ('00000000-0000-4000-a000-000000000001', 'Shrine Gate Event Desk', 'مزار گیٹ ایونٹ ڈیسک', 'event_desk', 30.2002, 71.4690, true),
  ('00000000-0000-4000-a000-000000000002', 'Ghanta Ghar Help Desk', 'گھنٹہ گھر ہیلپ ڈیسک', 'police_desk', 30.1978, 71.4698, false),
  ('00000000-0000-4000-a000-000000000003', 'Hussain Agahi Shop #12', 'حسین آگاہی دکان نمبر ۱۲', 'shop', 30.1962, 71.4738, false),
  ('00000000-0000-4000-a000-000000000004', 'Edhi Centre (demo)', 'ایدھی سینٹر (ڈیمو)', 'edhi', 30.1940, 71.4655, true),
  ('00000000-0000-4000-a000-000000000005', 'Masjid Help Point', 'مسجد ہیلپ پوائنٹ', 'mosque', 30.1990, 71.4720, false)
on conflict (id) do update set
  name_en = excluded.name_en, name_ur = excluded.name_ur, kind = excluded.kind,
  lat = excluded.lat, lng = excluded.lng, women_staff = excluded.women_staff, active = true;
