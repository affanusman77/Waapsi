-- F3: WhatsApp alerts. Settings read by supabase/functions/_shared/whatsapp.ts (an env secret of the
-- same name in UPPER_CASE wins). Twilio credentials are secrets only: TWILIO_ACCOUNT_SID,
-- TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
--   police_whatsapp : comma-separated +92… numbers of the police control room (demo: the police demo account)
--   app_url         : public app URL used for links in messages (empty = no links)
insert into public.app_settings (key, value) values
  ('police_whatsapp', '+923000000006'),
  ('app_url', '')
on conflict (key) do nothing;
