-- ════════════════════════════════════════════════════════════════════
-- Moka Réservation — Sprint 1 — Fondations multi-entreprises
-- Tables : profiles, platform_admins, businesses, business_members,
--          business_settings, locations, subscriptions
-- Sécurité : RLS sur toutes les tables, fonctions d'autorisation dans
--            un schéma privé non exposé par l'API.
-- ════════════════════════════════════════════════════════════════════

-- ─── Schéma privé (non exposé par l'API Supabase) ───────────────────
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ─── Types énumérés ─────────────────────────────────────────────────
create type public.activity_mode as enum ('home', 'salon', 'hybrid');
create type public.member_role as enum ('business_owner', 'staff');
create type public.location_kind as enum ('salon', 'travel_base');
create type public.subscription_plan as enum ('solo', 'complet');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'incomplete');

-- Préparés pour les sprints suivants (rendez-vous et paiements).
-- Créés dès maintenant pour figer le vocabulaire métier.
create type public.appointment_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.deposit_type as enum ('none', 'fixed', 'percentage');
create type public.payment_status as enum ('unpaid', 'deposit_pending', 'deposit_paid', 'paid', 'refunded', 'failed');

-- ─── Utilitaire : mise à jour automatique de updated_at ─────────────
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- TABLES
-- ════════════════════════════════════════════════════════════════════

-- Profil d'un utilisateur (1 ligne par compte Supabase Auth)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  phone text check (char_length(phone) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Administrateurs de la plateforme (Moka Studio). Aucune interface au Sprint 1.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Entreprise d'une professionnelle
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  activity text check (char_length(activity) <= 80),
  activity_mode public.activity_mode,
  phone text check (char_length(phone) <= 30),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  logo_path text check (char_length(logo_path) <= 300),
  onboarding_step smallint not null default 1 check (onboarding_step between 1 and 5),
  onboarding_completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_created_by_idx on public.businesses (created_by);

-- Appartenance d'un utilisateur à une entreprise
create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index business_members_user_id_idx on public.business_members (user_id);

-- Paramètres de l'entreprise (1 ligne par entreprise)
create table public.business_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  timezone text not null default 'Europe/Paris',
  currency char(3) not null default 'EUR' check (currency = 'EUR'),
  default_appointment_minutes integer not null default 60
    check (default_appointment_minutes between 5 and 480),
  service_radius_km integer check (service_radius_km between 0 and 200),
  booking_terms text check (char_length(booking_terms) <= 10000),
  updated_at timestamptz not null default now()
);

-- Adresses : institut et/ou point de départ des déplacements
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind public.location_kind not null,
  address_line1 text not null check (char_length(btrim(address_line1)) between 1 and 200),
  address_line2 text check (char_length(address_line2) <= 200),
  postal_code text check (char_length(postal_code) <= 12),
  city text not null check (char_length(btrim(city)) between 1 and 100),
  country char(2) not null default 'FR',
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, kind)
);

-- Abonnement Moka (écrit uniquement côté serveur / Stripe, sprint ultérieur)
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  plan public.subscription_plan not null default 'solo',
  status public.subscription_status not null default 'incomplete',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger businesses_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();
create trigger business_settings_updated_at before update on public.business_settings
  for each row execute function private.set_updated_at();
create trigger locations_updated_at before update on public.locations
  for each row execute function private.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- Validation du fuseau horaire contre la liste PostgreSQL
create or replace function private.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuseau horaire invalide : %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger business_settings_timezone before insert or update of timezone on public.business_settings
  for each row execute function private.validate_timezone();

-- Création automatique du profil à l'inscription
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ════════════════════════════════════════════════════════════════════
-- FONCTIONS D'AUTORISATION (utilisées par les politiques RLS)
-- security definer : évite la récursion RLS sur business_members.
-- ════════════════════════════════════════════════════════════════════

create or replace function private.is_business_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_business_role(p_business_id uuid, p_roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

-- Conversion sûre texte → uuid (chemins Storage)
create or replace function private.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

revoke all on all functions in schema private from public;
grant execute on function private.is_business_member(uuid) to authenticated;
grant execute on function private.has_business_role(uuid, public.member_role[]) to authenticated;
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.try_uuid(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- CRÉATION D'ENTREPRISE (transaction unique, appelée par l'onboarding)
-- Crée l'entreprise, le membre propriétaire et les paramètres.
-- Idempotente : renvoie l'entreprise existante si l'utilisateur en a déjà une.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.create_business(
  p_name text,
  p_activity text default null,
  p_phone text default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_business uuid;
begin
  if v_user is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  select m.business_id into v_business
  from public.business_members m
  where m.user_id = v_user and m.role = 'business_owner'
  order by m.created_at
  limit 1;

  if v_business is not null then
    return v_business;
  end if;

  insert into public.businesses (name, activity, phone, email, created_by, onboarding_step)
  values (btrim(p_name), nullif(btrim(p_activity), ''), nullif(btrim(p_phone), ''),
          nullif(lower(btrim(p_email)), ''), v_user, 2)
  returning id into v_business;

  insert into public.business_members (business_id, user_id, role)
  values (v_business, v_user, 'business_owner');

  insert into public.business_settings (business_id) values (v_business);

  return v_business;
end;
$$;

revoke all on function public.create_business(text, text, text, text) from public, anon;
grant execute on function public.create_business(text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- PRIVILÈGES DE BASE
-- Supabase accorde par défaut tous les droits aux rôles anon et
-- authenticated : on les réduit au strict nécessaire (défense en profondeur).
-- ════════════════════════════════════════════════════════════════════
revoke all on public.profiles, public.platform_admins, public.businesses,
  public.business_members, public.business_settings, public.locations,
  public.subscriptions from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

grant select on public.businesses to authenticated;
grant update (name, activity, activity_mode, phone, email, logo_path, onboarding_step, onboarding_completed_at)
  on public.businesses to authenticated;

grant select on public.business_members to authenticated;

grant select on public.business_settings to authenticated;
grant update (timezone, default_appointment_minutes, service_radius_km, booking_terms)
  on public.business_settings to authenticated;

grant select, delete on public.locations to authenticated;
grant insert (business_id, kind, address_line1, address_line2, postal_code, city, country, latitude, longitude)
  on public.locations to authenticated;
grant update (address_line1, address_line2, postal_code, city, country, latitude, longitude)
  on public.locations to authenticated;

grant select on public.subscriptions to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.business_settings enable row level security;
alter table public.locations enable row level security;
alter table public.subscriptions enable row level security;

-- profiles : chacun ne voit et ne modifie que son profil
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- platform_admins : aucune politique → inaccessible aux utilisateurs (service_role uniquement)

-- businesses
create policy businesses_select_member on public.businesses
  for select to authenticated using ((select private.is_business_member(id)));
create policy businesses_update_owner on public.businesses
  for update to authenticated
  using ((select private.has_business_role(id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(id, array['business_owner']::public.member_role[])));

-- business_members : lecture des membres de ses propres entreprises (écriture : fonctions serveur)
create policy business_members_select_member on public.business_members
  for select to authenticated using ((select private.is_business_member(business_id)));

-- business_settings
create policy business_settings_select_member on public.business_settings
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy business_settings_update_owner on public.business_settings
  for update to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));

-- locations
create policy locations_select_member on public.locations
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy locations_insert_owner on public.locations
  for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy locations_update_owner on public.locations
  for update to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy locations_delete_owner on public.locations
  for delete to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));

-- subscriptions : lecture par les membres, écriture serveur uniquement
create policy subscriptions_select_member on public.subscriptions
  for select to authenticated using ((select private.is_business_member(business_id)));
