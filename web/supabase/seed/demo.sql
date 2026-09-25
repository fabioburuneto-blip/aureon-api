-- =========================================================================
-- OPTIONAL, dev/staging-only demo data. NEVER run this against a
-- production Supabase project -- "não use dados fake em produção" is a
-- hard rule, not a suggestion. Not referenced by any migration, not
-- wired into `supabase db push`, and not run automatically by anything
-- in this repo; it only runs if you explicitly point psql at it.
--
-- Gives a fresh local/dev/staging project one working demo business
-- (services, professionals, weekly hours, a themed public page) to click
-- around immediately after applying migrations, instead of walking
-- through /signup -> confirm email -> /onboarding by hand every time you
-- reset the database.
--
-- Inserts directly into the same tables create_business() would write to
-- (bypassing the RPC, since it requires a real authenticated session) --
-- including a synthetic auth.users row. That row has no usable password:
-- inserting into auth.users directly does not go through Supabase Auth's
-- password hashing, so "logging in" as this demo user isn't the point --
-- the point is a populated public page and dashboard-shaped data to look
-- at. Every insert targets a fixed UUID with `on conflict do nothing`, so
-- running this more than once (e.g. after `supabase db reset`) is a
-- no-op, not a duplicate.
--
-- Usage (local/dev/staging ONLY):
--   psql "$DATABASE_URL" -f supabase/seed/demo.sql
-- =========================================================================
\set ON_ERROR_STOP on

\set demo_user_id '''d0000000-0000-0000-0000-00000000d001'''
\set demo_business_id '''d0000000-0000-0000-0000-00000000d002'''
\set svc_corte_id '''d0000000-0000-0000-0000-00000000d011'''
\set svc_barba_id '''d0000000-0000-0000-0000-00000000d012'''
\set svc_combo_id '''d0000000-0000-0000-0000-00000000d013'''
\set pro_rafael_id '''d0000000-0000-0000-0000-00000000d021'''
\set pro_priscila_id '''d0000000-0000-0000-0000-00000000d022'''

insert into auth.users (id, email)
values (:demo_user_id, 'demo@aureon-agenda.local')
on conflict (id) do nothing;

insert into public.profiles (id, full_name)
values (:demo_user_id, 'Demo Owner')
on conflict (id) do nothing;

insert into public.businesses (
  id, owner_id, name, slug, segment, description, phone, email,
  timezone, is_published
) values (
  :demo_business_id, :demo_user_id, 'Barbearia Demo', 'barbearia-demo',
  'barbershop', 'Empresa de demonstração -- dados fictícios, nunca use em produção.',
  '+5511999990000', 'contato@barbearia-demo.local',
  'America/Sao_Paulo', true
)
on conflict (id) do nothing;

insert into public.business_settings (business_id)
values (:demo_business_id)
on conflict (business_id) do nothing;

insert into public.business_members (business_id, user_id, role)
values (:demo_business_id, :demo_user_id, 'owner')
on conflict (business_id, user_id) do nothing;

insert into public.themes (business_id, primary_color, secondary_color, font, layout)
values (:demo_business_id, '#18181b', '#f59e0b', 'inter', 'classic')
on conflict (business_id) do nothing;

insert into public.subscriptions (
  business_id, provider, plan_id, status, current_period_start, current_period_end
) values (
  :demo_business_id, 'local', 'pro', 'active', now(), now() + interval '30 days'
)
on conflict (business_id) do nothing;

insert into public.services (id, business_id, name, description, duration_minutes, price_cents, position)
values
  (:svc_corte_id, :demo_business_id, 'Corte Masculino', 'Corte na tesoura ou máquina, com acabamento.', 45, 5000, 0),
  (:svc_barba_id, :demo_business_id, 'Barba', 'Modelagem e navalha.', 30, 3500, 1),
  (:svc_combo_id, :demo_business_id, 'Corte + Barba', 'Combo completo.', 70, 8000, 2)
on conflict (id) do nothing;

insert into public.professionals (id, business_id, name, bio, position)
values
  (:pro_rafael_id, :demo_business_id, 'Rafael Silva', 'Barbeiro há 8 anos.', 0),
  (:pro_priscila_id, :demo_business_id, 'Priscila Souza', 'Especialista em cortes modernos.', 1)
on conflict (id) do nothing;

insert into public.professional_services (professional_id, service_id)
values
  (:pro_rafael_id, :svc_corte_id),
  (:pro_rafael_id, :svc_barba_id),
  (:pro_rafael_id, :svc_combo_id),
  (:pro_priscila_id, :svc_corte_id),
  (:pro_priscila_id, :svc_combo_id)
on conflict (professional_id, service_id) do nothing;

-- Segunda a sexta 09:00-19:00, sábado 09:00-14:00, domingo fechado.
insert into public.business_hours (business_id, day_of_week, start_time, end_time, is_closed)
values
  (:demo_business_id, 0, '00:00', '00:00', true),
  (:demo_business_id, 1, '09:00', '19:00', false),
  (:demo_business_id, 2, '09:00', '19:00', false),
  (:demo_business_id, 3, '09:00', '19:00', false),
  (:demo_business_id, 4, '09:00', '19:00', false),
  (:demo_business_id, 5, '09:00', '19:00', false),
  (:demo_business_id, 6, '09:00', '14:00', false)
on conflict (business_id, day_of_week) do nothing;

\echo 'Demo business ready: /barbearia-demo'
