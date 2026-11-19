-- ════════════════════════════════════════════════════════════════════
-- Moka Réservation — Sprint 2 — Catalogue de prestations et CRM clientes
-- Tables : service_categories, services, service_locations, service_costs,
--          customers, customer_addresses, customer_consents
-- Principes :
--  • montants en centimes entiers ; prix saisis TTC, TVA en points de base
--    (2000 = 20 %) pour calculer le HT ;
--  • archivage logique (archived_at), jamais de suppression des fiches ;
--  • clés étrangères COMPOSITES (id, business_id) : impossible de rattacher
--    une prestation, un coût ou une adresse à une autre entreprise ;
--  • business_id non modifiable ; created_by / updated_by posés par la base.
-- ════════════════════════════════════════════════════════════════════

-- ─── Types ──────────────────────────────────────────────────────────
create type public.service_place as enum ('home', 'salon');
create type public.service_cost_kind as enum ('consumables', 'products', 'other');
create type public.contact_preference as enum ('any', 'email', 'sms', 'phone', 'none');
create type public.customer_source as enum ('manual', 'import', 'booking');
create type public.address_kind as enum ('home', 'work', 'other');
create type public.consent_channel as enum ('email', 'sms');

-- ─── Déclencheurs génériques ────────────────────────────────────────

-- Tables principales : traçabilité + business_id figé
create or replace function private.audit_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.updated_by := new.created_by;
    new.created_at := now();
    new.updated_at := now();
  else
    if new.business_id is distinct from old.business_id then
      raise exception 'Le rattachement à une entreprise ne peut pas être modifié' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce((select auth.uid()), new.updated_by);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Tables liées : business_id figé + updated_at
create or replace function private.lock_business_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'Le rattachement à une entreprise ne peut pas être modifié' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- PRESTATIONS
-- ════════════════════════════════════════════════════════════════════

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (char_length(description) <= 500),
  position integer not null default 0 check (position between 0 and 10000),
  is_visible boolean not null default true,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);
create unique index service_categories_name_active_uidx
  on public.service_categories (business_id, lower(btrim(name))) where archived_at is null;
create index service_categories_business_position_idx on public.service_categories (business_id, position);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  category_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  photo_path text check (char_length(photo_path) <= 300),
  -- Temps (minutes)
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  prep_minutes integer not null default 0 check (prep_minutes between 0 and 240),
  cleanup_minutes integer not null default 0 check (cleanup_minutes between 0 and 240),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 240),
  min_notice_minutes integer not null default 0 check (min_notice_minutes between 0 and 43200),
  -- Statut
  is_active boolean not null default true,
  online_bookable boolean not null default true,
  -- Tarification (centimes TTC)
  base_price_cents integer not null check (base_price_cents between 0 and 10000000),
  promo_price_cents integer check (promo_price_cents between 0 and 10000000),
  extra_fee_cents integer not null default 0 check (extra_fee_cents between 0 and 10000000),
  extra_fee_label text check (char_length(extra_fee_label) <= 80),
  vat_rate_bps smallint not null default 0 check (vat_rate_bps in (0, 550, 1000, 2000)),
  -- Acompte : fixe en centimes, pourcentage de 0 à 100
  deposit_type public.deposit_type not null default 'none',
  deposit_value integer not null default 0,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (category_id, business_id) references public.service_categories (id, business_id),
  constraint services_promo_le_base check (promo_price_cents is null or promo_price_cents <= base_price_cents),
  constraint services_deposit_valid check (
    (deposit_type = 'none' and deposit_value = 0)
    or (deposit_type = 'fixed' and deposit_value between 0 and 10000000)
    or (deposit_type = 'percentage' and deposit_value between 0 and 100)
  )
);
create unique index services_name_active_uidx
  on public.services (business_id, lower(btrim(name))) where archived_at is null;
create index services_business_category_idx on public.services (business_id, category_id);

-- Lieux où la prestation est proposée, avec tarif propre éventuel
create table public.service_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  service_id uuid not null,
  place public.service_place not null,
  price_cents integer check (price_cents between 0 and 10000000), -- null = prix de base
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, service_id, place),
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);
create index service_locations_business_idx on public.service_locations (business_id);

-- Coûts internes estimés (une ligne par type)
create table public.service_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  service_id uuid not null,
  kind public.service_cost_kind not null,
  label text check (char_length(label) <= 80),
  amount_cents integer not null check (amount_cents between 0 and 10000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, service_id, kind),
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);
create index service_costs_business_idx on public.service_costs (business_id);

-- ════════════════════════════════════════════════════════════════════
-- CLIENTES
-- ════════════════════════════════════════════════════════════════════

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 80),
  last_name text not null default '' check (char_length(last_name) <= 80),
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (char_length(phone) <= 30),
  -- Valeurs normalisées pour la recherche et la détection des doublons
  email_normalized text generated always as (lower(btrim(email))) stored,
  phone_normalized text generated always as (
    nullif(regexp_replace(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '^(?:00)?33([1-9][0-9]{8})$', '0\1'), '')
  ) stored,
  birth_date date check (birth_date >= date '1900-01-01'),
  notes text check (char_length(notes) <= 5000),
  preferences text check (char_length(preferences) <= 2000),
  contact_preference public.contact_preference not null default 'any',
  source public.customer_source not null default 'manual',
  import_key text check (char_length(import_key) <= 128),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  constraint customers_has_name check (char_length(btrim(first_name || last_name)) > 0)
);
create index customers_business_name_idx on public.customers (business_id, lower(last_name), lower(first_name));
create index customers_business_email_idx on public.customers (business_id, email_normalized);
create index customers_business_phone_idx on public.customers (business_id, phone_normalized);
-- Import idempotent : une même ligne ne peut être importée qu'une fois
create unique index customers_import_key_uidx on public.customers (business_id, import_key) where import_key is not null;

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  customer_id uuid not null,
  kind public.address_kind not null default 'home',
  label text check (char_length(label) <= 60),
  line1 text not null check (char_length(btrim(line1)) between 1 and 200),
  line2 text check (char_length(line2) <= 200),
  postal_code text check (char_length(postal_code) <= 12),
  city text not null check (char_length(btrim(city)) between 1 and 100),
  country char(2) not null default 'FR',
  is_primary boolean not null default false,
  -- Géolocalisation : renseignée uniquement par un géocodage validé (sprint Tournées)
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  geocoded_at timestamptz,
  geocode_source text check (char_length(geocode_source) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete cascade,
  constraint customer_addresses_coords_pair check ((latitude is null) = (longitude is null)),
  constraint customer_addresses_coords_validated check (latitude is null or geocoded_at is not null)
);
create unique index customer_addresses_one_primary_uidx on public.customer_addresses (customer_id) where is_primary;
create index customer_addresses_business_idx on public.customer_addresses (business_id, customer_id);

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  customer_id uuid not null,
  channel public.consent_channel not null,
  purpose text not null default 'marketing' check (purpose in ('marketing')),
  granted boolean not null,
  source public.customer_source not null default 'manual',
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, customer_id, channel, purpose),
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete cascade
);
create index customer_consents_business_idx on public.customer_consents (business_id, customer_id);

-- ─── Déclencheurs ───────────────────────────────────────────────────
create trigger service_categories_audit before insert or update on public.service_categories
  for each row execute function private.audit_row();
create trigger services_audit before insert or update on public.services
  for each row execute function private.audit_row();
create trigger customers_audit before insert or update on public.customers
  for each row execute function private.audit_row();
create trigger service_locations_lock before update on public.service_locations
  for each row execute function private.lock_business_id();
create trigger service_costs_lock before update on public.service_costs
  for each row execute function private.lock_business_id();
create trigger customer_addresses_lock before update on public.customer_addresses
  for each row execute function private.lock_business_id();
create trigger customer_consents_lock before update on public.customer_consents
  for each row execute function private.lock_business_id();

-- ════════════════════════════════════════════════════════════════════
-- DUPLICATION D'UNE PRESTATION (atomique, soumise à la RLS de l'appelant)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.duplicate_service(p_service_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src public.services%rowtype;
  v_new uuid;
  v_name text;
  v_n integer := 1;
begin
  select * into v_src from public.services where id = p_service_id;
  if not found then
    raise exception 'Prestation introuvable' using errcode = 'P0002';
  end if;

  v_name := left(v_src.name, 110) || ' (copie)';
  while exists (
    select 1 from public.services
    where business_id = v_src.business_id and archived_at is null and lower(btrim(name)) = lower(v_name)
  ) loop
    v_n := v_n + 1;
    v_name := left(v_src.name, 106) || ' (copie ' || v_n || ')';
  end loop;

  insert into public.services (
    business_id, category_id, name, description, photo_path, duration_minutes, prep_minutes,
    cleanup_minutes, buffer_minutes, min_notice_minutes, is_active, online_bookable,
    base_price_cents, promo_price_cents, extra_fee_cents, extra_fee_label, vat_rate_bps,
    deposit_type, deposit_value
  ) values (
    v_src.business_id, v_src.category_id, v_name, v_src.description, v_src.photo_path, v_src.duration_minutes,
    v_src.prep_minutes, v_src.cleanup_minutes, v_src.buffer_minutes, v_src.min_notice_minutes,
    false, v_src.online_bookable, v_src.base_price_cents, v_src.promo_price_cents, v_src.extra_fee_cents,
    v_src.extra_fee_label, v_src.vat_rate_bps, v_src.deposit_type, v_src.deposit_value
  ) returning id into v_new;

  insert into public.service_locations (business_id, service_id, place, price_cents)
  select business_id, v_new, place, price_cents from public.service_locations where service_id = p_service_id;

  insert into public.service_costs (business_id, service_id, kind, label, amount_cents)
  select business_id, v_new, kind, label, amount_cents from public.service_costs where service_id = p_service_id;

  return v_new;
end;
$$;
revoke all on function public.duplicate_service(uuid) from public, anon;
grant execute on function public.duplicate_service(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- DROITS (défense en profondeur) — pas de suppression des fiches principales
-- ════════════════════════════════════════════════════════════════════
revoke all on public.service_categories, public.services, public.service_locations, public.service_costs,
  public.customers, public.customer_addresses, public.customer_consents from anon, authenticated;

grant select, insert, update on public.service_categories, public.services, public.customers to authenticated;
grant select, insert, update, delete on public.service_locations, public.service_costs,
  public.customer_addresses, public.customer_consents to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Catalogue : lecture membres, écriture propriétaire.
-- Clientes : lecture et écriture propriétaire + staff.
-- ════════════════════════════════════════════════════════════════════
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.service_locations enable row level security;
alter table public.service_costs enable row level security;
alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.customer_consents enable row level security;

-- Catalogue
create policy service_categories_select on public.service_categories
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy service_categories_insert on public.service_categories
  for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy service_categories_update on public.service_categories
  for update to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));

create policy services_select on public.services
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy services_insert on public.services
  for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy services_update on public.services
  for update to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));

create policy service_locations_select on public.service_locations
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy service_locations_write on public.service_locations
  for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));

create policy service_costs_select on public.service_costs
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy service_costs_write on public.service_costs
  for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));

-- Clientes (propriétaire + staff)
create policy customers_select on public.customers
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy customers_insert on public.customers
  for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));
create policy customers_update on public.customers
  for update to authenticated
  using ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));

create policy customer_addresses_select on public.customer_addresses
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy customer_addresses_write on public.customer_addresses
  for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));

create policy customer_consents_select on public.customer_consents
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy customer_consents_write on public.customer_consents
  for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));

-- ════════════════════════════════════════════════════════════════════
-- STOCKAGE DES PHOTOS DE PRESTATIONS — chemin {business_id}/{fichier}
-- ════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-photos', 'service-photos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy service_photos_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'service-photos'
    and (select private.has_business_role(private.try_uuid((storage.foldername(name))[1]), array['business_owner']::public.member_role[]))
  );
create policy service_photos_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'service-photos'
    and (select private.has_business_role(private.try_uuid((storage.foldername(name))[1]), array['business_owner']::public.member_role[]))
  )
  with check (
    bucket_id = 'service-photos'
    and (select private.has_business_role(private.try_uuid((storage.foldername(name))[1]), array['business_owner']::public.member_role[]))
  );
create policy service_photos_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'service-photos'
    and (select private.has_business_role(private.try_uuid((storage.foldername(name))[1]), array['business_owner']::public.member_role[]))
  );
create policy service_photos_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'service-photos'
    and (select private.is_business_member(private.try_uuid((storage.foldername(name))[1])))
  );
