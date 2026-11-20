-- ════════════════════════════════════════════════════════════════════
-- Moka Réservation — Sprint 5 — Déplacements, frais, tournées
--
-- Principes :
--  • aucune distance ni durée n'est inventée : seules les estimations
--    calculées par le fournisseur d'itinéraires (IGN Géoplateforme) et
--    SIGNÉES par le serveur de l'application sont acceptées en base ;
--  • la clé de signature est créée ICI, dans la base, et copiée par la
--    professionnelle dans Vercel : elle ne transite par aucun autre canal ;
--  • frais facturés et zones sont recalculés PAR LA BASE à la réservation
--    publique (le navigateur n'envoie jamais de montant) ;
--  • faisabilité des trajets entre rendez-vous vérifiée par un déclencheur,
--    avant ET après le rendez-vous, avec une marge de sécurité ;
--  • tant que les déplacements ne sont pas activés, rien ne change
--    (non-régression des Sprints 3 et 4) ;
--  • adresses privées (point de départ, coordonnées des clientes) jamais
--    renvoyées aux visiteurs.
-- Aucune donnée existante n'est supprimée ni écrasée.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ─── 1. Clé de signature serveur ────────────────────────────────────
create table private.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
revoke all on private.app_secrets from public;
insert into private.app_secrets (name, value)
values ('travel_signing', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

create or replace function private.server_signature(p_message text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.hmac(p_message, s.value, 'sha256'), 'hex')
  from private.app_secrets s where s.name = 'travel_signing';
$$;

create or replace function private.signature_ok(p_message text, p_signature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_signature is not null and p_signature ~ '^[0-9a-f]{64}$'
     and private.server_signature(p_message) = p_signature;
$$;

-- Format commun des coordonnées dans les messages signés (6 décimales)
create or replace function private.coord(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$ select round(p, 6)::text $$;

revoke all on function private.server_signature(text) from public;
revoke all on function private.signature_ok(text, text) from public;
revoke all on function private.coord(numeric) from public;

-- ─── 2. Points de départ (adresses existantes, géolocalisées) ───────
alter table public.locations
  add column geocoded_at timestamptz,
  add column geocode_label text check (char_length(geocode_label) <= 300),
  add constraint locations_coords_pair check ((latitude is null) = (longitude is null)),
  add constraint locations_coords_validated check (latitude is null or geocoded_at is not null);
grant update (geocoded_at, geocode_label) on public.locations to authenticated;
grant insert (geocoded_at, geocode_label) on public.locations to authenticated;

-- ─── 3. Réglages des déplacements ───────────────────────────────────
create table public.travel_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  enabled boolean not null default false,
  start_point text not null default 'travel_base' check (start_point in ('travel_base', 'salon')),
  return_point text not null default 'none' check (return_point in ('none', 'travel_base', 'salon')),
  safety_margin_pct smallint not null default 20 check (safety_margin_pct between 0 and 100),
  safety_margin_minutes smallint not null default 5 check (safety_margin_minutes between 0 and 60),
  pricing_mode text not null default 'free' check (pricing_mode in ('free', 'fixed', 'per_km', 'zone', 'free_above')),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents between 0 and 100000),
  per_km_cents integer not null default 0 check (per_km_cents between 0 and 1000),
  included_km numeric(6, 1) not null default 0 check (included_km between 0 and 500),
  min_fee_cents integer not null default 0 check (min_fee_cents between 0 and 100000),
  max_fee_cents integer check (max_fee_cents between 0 and 100000),
  free_above_cents integer check (free_above_cents between 0 and 10000000),
  fee_vat_rate_bps smallint not null default 0 check (fee_vat_rate_bps in (0, 550, 1000, 2000)),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_settings_min_max check (max_fee_cents is null or max_fee_cents >= min_fee_cents),
  constraint travel_settings_free_above check (pricing_mode <> 'free_above' or free_above_cents is not null)
);

create or replace function private.travel_settings_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'Le rattachement à une entreprise ne peut pas être modifié' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger travel_settings_version before update on public.travel_settings
  for each row execute function private.travel_settings_version();

-- ─── 4. Véhicules ───────────────────────────────────────────────────
-- Montants en millièmes d'euro (« millis ») pour les prix unitaires fins
-- (1,859 €/L = 1859), en centimes pour les forfaits.
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  kind text not null check (kind in ('car_fuel', 'car_electric', 'car_hybrid', 'two_wheeler', 'bike', 'other')),
  consumption_per_100km numeric(6, 2) check (consumption_per_100km between 0 and 100),
  energy_unit text check (energy_unit in ('l', 'kwh')),
  energy_price_millis integer check (energy_price_millis between 0 and 10000),
  wear_cost_per_km_millis integer not null default 0 check (wear_cost_per_km_millis between 0 and 5000),
  all_in_cost_per_km_millis integer check (all_in_cost_per_km_millis between 0 and 5000),
  fixed_cost_per_trip_cents integer not null default 0 check (fixed_cost_per_trip_cents between 0 and 100000),
  parking_tolls_per_trip_cents integer not null default 0 check (parking_tolls_per_trip_cents between 0 and 100000),
  hourly_time_cost_cents integer not null default 0 check (hourly_time_cost_cents between 0 and 100000),
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  constraint vehicles_energy check ((consumption_per_100km is null) = (energy_unit is null))
);
create unique index vehicles_one_default_uidx on public.vehicles (business_id) where is_default and archived_at is null;
create trigger vehicles_lock before update on public.vehicles
  for each row execute function private.lock_business_id();

-- ─── 5. Zones d'intervention ────────────────────────────────────────
create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('radius', 'postcodes')),
  max_km numeric(6, 1) check (max_km between 0 and 500),
  postcodes text[] check (postcodes is null or (array_length(postcodes, 1) between 1 and 200)),
  excluded boolean not null default false,
  surcharge_cents integer not null default 0 check (surcharge_cents between 0 and 100000),
  min_order_cents integer not null default 0 check (min_order_cents between 0 and 10000000),
  weekdays smallint[] check (weekdays is null or weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  position integer not null default 0 check (position between 0 and 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_areas_kind check (
    (kind = 'radius' and max_km is not null) or (kind = 'postcodes' and postcodes is not null)
  )
);
create index service_areas_business_idx on public.service_areas (business_id, position);
create trigger service_areas_lock before update on public.service_areas
  for each row execute function private.lock_business_id();

-- ─── 6. Caches : adresses géocodées et trajets ──────────────────────
create table public.geocoded_addresses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  query_hash text not null check (query_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (char_length(label) <= 300),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  postcode text check (char_length(postcode) <= 12),
  city text check (char_length(city) <= 100),
  score numeric(4, 3) check (score between 0 and 1),
  provider text not null check (char_length(provider) <= 40),
  created_at timestamptz not null default now(),
  unique (business_id, query_hash)
);

-- Trajets : écrits UNIQUEMENT par public.record_travel_estimate (signature serveur)
create table public.travel_estimates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  from_lat numeric(9, 6) not null,
  from_lng numeric(9, 6) not null,
  to_lat numeric(9, 6) not null,
  to_lng numeric(9, 6) not null,
  distance_m integer not null check (distance_m between 0 and 2000000),
  duration_s integer not null check (duration_s between 0 and 172800),
  provider text not null check (char_length(provider) <= 40),
  computed_at timestamptz not null,
  expires_at timestamptz not null,
  geometry jsonb,
  created_at timestamptz not null default now(),
  unique (business_id, from_lat, from_lng, to_lat, to_lng)
);

-- ─── 7. Rendez-vous : coordonnées et contrôle des trajets ───────────
alter table public.appointments
  add column latitude numeric(9, 6) check (latitude between -90 and 90),
  add column longitude numeric(9, 6) check (longitude between -180 and 180),
  add column travel_check text not null default 'not_required'
    check (travel_check in ('not_required', 'verified', 'skipped_by_pro')),
  add constraint appointments_coords_pair check ((latitude is null) = (longitude is null));

alter table public.appointment_items
  add column kind text not null default 'service' check (kind in ('service', 'travel_fee'));

-- Instantané du trajet et de son coût (figé à la réservation ou au recalcul)
alter table public.appointment_travel
  drop constraint if exists appointment_travel_origin_check;
alter table public.appointment_travel
  add constraint appointment_travel_origin_check check (origin in ('travel_base', 'salon', 'previous_appointment')),
  add column vehicle_id uuid,
  add column vehicle_snapshot jsonb,
  add column settings_version integer,
  add column zone_name text check (char_length(zone_name) <= 60),
  add column fee_vat_rate_bps smallint check (fee_vat_rate_bps in (0, 550, 1000, 2000)),
  add column energy_cost_cents integer check (energy_cost_cents >= 0),
  add column wear_cost_cents integer check (wear_cost_cents >= 0),
  add column time_cost_cents integer check (time_cost_cents >= 0),
  add column other_cost_cents integer check (other_cost_cents >= 0),
  add column economic_cost_cents integer check (economic_cost_cents >= 0);

-- ─── 8. Tournées proposées ──────────────────────────────────────────
create table public.route_plans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  day date not null,
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'dismissed')),
  current_distance_m integer check (current_distance_m >= 0),
  current_duration_s integer check (current_duration_s >= 0),
  current_cost_cents integer check (current_cost_cents >= 0),
  proposed_distance_m integer check (proposed_distance_m >= 0),
  proposed_duration_s integer check (proposed_duration_s >= 0),
  proposed_cost_cents integer check (proposed_cost_cents >= 0),
  settings_version integer,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id)
);
create index route_plans_business_day_idx on public.route_plans (business_id, day);

create table public.route_plan_stops (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  route_plan_id uuid not null,
  appointment_id uuid not null,
  position smallint not null check (position between 1 and 50),
  current_starts_at timestamptz not null,
  proposed_starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (route_plan_id, business_id) references public.route_plans (id, business_id) on delete cascade,
  foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade,
  unique (route_plan_id, position)
);

create trigger route_plans_lock before update on public.route_plans
  for each row execute function private.lock_business_id();

-- ─── 9. Droits et RLS ───────────────────────────────────────────────
revoke all on public.travel_settings, public.vehicles, public.service_areas, public.geocoded_addresses,
  public.travel_estimates, public.route_plans, public.route_plan_stops from anon, authenticated;

grant select, insert on public.travel_settings to authenticated;
grant update (enabled, start_point, return_point, safety_margin_pct, safety_margin_minutes, pricing_mode,
  fixed_fee_cents, per_km_cents, included_km, min_fee_cents, max_fee_cents, free_above_cents, fee_vat_rate_bps)
  on public.travel_settings to authenticated;
grant select, insert, update on public.vehicles to authenticated;
grant select, insert, update, delete on public.service_areas to authenticated;
grant select, insert on public.geocoded_addresses to authenticated;
grant select on public.travel_estimates to authenticated;
grant select, insert, update on public.route_plans to authenticated;
grant select, insert on public.route_plan_stops to authenticated;

alter table public.travel_settings enable row level security;
alter table public.vehicles enable row level security;
alter table public.service_areas enable row level security;
alter table public.geocoded_addresses enable row level security;
alter table public.travel_estimates enable row level security;
alter table public.route_plans enable row level security;
alter table public.route_plan_stops enable row level security;
alter table private.app_secrets enable row level security;

create policy travel_settings_select on public.travel_settings for select to authenticated using ((select private.is_business_member(business_id)));
create policy travel_settings_write on public.travel_settings for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy vehicles_select on public.vehicles for select to authenticated using ((select private.is_business_member(business_id)));
create policy vehicles_write on public.vehicles for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy service_areas_select on public.service_areas for select to authenticated using ((select private.is_business_member(business_id)));
create policy service_areas_write on public.service_areas for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy geocoded_addresses_select on public.geocoded_addresses for select to authenticated using ((select private.is_business_member(business_id)));
create policy geocoded_addresses_insert on public.geocoded_addresses for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));
create policy travel_estimates_select on public.travel_estimates for select to authenticated using ((select private.is_business_member(business_id)));
create policy route_plans_select on public.route_plans for select to authenticated using ((select private.is_business_member(business_id)));
create policy route_plans_write on public.route_plans for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));
create policy route_plan_stops_select on public.route_plan_stops for select to authenticated using ((select private.is_business_member(business_id)));
create policy route_plan_stops_insert on public.route_plan_stops for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));

-- Réglages créés pour chaque entreprise (existantes et futures), désactivés
insert into public.travel_settings (business_id) select id from public.businesses on conflict do nothing;
create or replace function private.business_travel_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.travel_settings (business_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
create trigger businesses_travel_settings after insert on public.businesses
  for each row execute function private.business_travel_settings();

-- ─── 10. Enregistrement signé d'un trajet ───────────────────────────
-- Message signé : route|v1|business|from_lat|from_lng|to_lat|to_lng|distance_m|duration_s|provider|computed_epoch
create or replace function public.record_travel_estimate(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
  v_from_lat numeric; v_from_lng numeric; v_to_lat numeric; v_to_lng numeric;
  v_distance integer; v_duration integer; v_provider text; v_epoch bigint;
  v_message text;
begin
  begin
    v_business := (p ->> 'business_id')::uuid;
    v_from_lat := round((p ->> 'from_lat')::numeric, 6); v_from_lng := round((p ->> 'from_lng')::numeric, 6);
    v_to_lat := round((p ->> 'to_lat')::numeric, 6); v_to_lng := round((p ->> 'to_lng')::numeric, 6);
    v_distance := (p ->> 'distance_m')::integer; v_duration := (p ->> 'duration_s')::integer;
    v_provider := p ->> 'provider'; v_epoch := (p ->> 'computed_epoch')::bigint;
  exception when others then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end;
  v_message := concat_ws('|', 'route', 'v1', v_business::text, private.coord(v_from_lat), private.coord(v_from_lng),
    private.coord(v_to_lat), private.coord(v_to_lng), v_distance::text, v_duration::text, v_provider, v_epoch::text);
  if not private.signature_ok(v_message, p ->> 'signature') then
    raise exception 'MOKA_BAD_SIGNATURE' using errcode = 'P0001';
  end if;
  if to_timestamp(v_epoch) > now() + interval '5 minutes' or to_timestamp(v_epoch) < now() - interval '1 day' then
    raise exception 'MOKA_STALE_ESTIMATE' using errcode = 'P0001';
  end if;

  insert into public.travel_estimates (business_id, from_lat, from_lng, to_lat, to_lng, distance_m, duration_s, provider, computed_at, expires_at, geometry)
  values (v_business, v_from_lat, v_from_lng, v_to_lat, v_to_lng, v_distance, v_duration, v_provider,
          to_timestamp(v_epoch), to_timestamp(v_epoch) + interval '90 days',
          case when jsonb_typeof(p -> 'geometry') = 'array' and jsonb_array_length(p -> 'geometry') <= 500 then p -> 'geometry' end)
  on conflict (business_id, from_lat, from_lng, to_lat, to_lng) do update set
    distance_m = excluded.distance_m, duration_s = excluded.duration_s, provider = excluded.provider,
    computed_at = excluded.computed_at, expires_at = excluded.expires_at,
    geometry = coalesce(excluded.geometry, public.travel_estimates.geometry);
end;
$$;

create or replace function private.travel_estimate(p_business uuid, p_from_lat numeric, p_from_lng numeric, p_to_lat numeric, p_to_lng numeric)
returns public.travel_estimates
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.travel_estimates t
  where t.business_id = p_business
    and t.from_lat = round(p_from_lat, 6) and t.from_lng = round(p_from_lng, 6)
    and t.to_lat = round(p_to_lat, 6) and t.to_lng = round(p_to_lng, 6)
    and t.expires_at > now()
  limit 1;
$$;

-- Coordonnées d'un arrêt : institut ou adresse du rendez-vous
create or replace function private.stop_coords(p_business uuid, p_place public.service_place, p_lat numeric, p_lng numeric, out lat numeric, out lng numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_place = 'salon' then l.latitude else p_lat end,
         case when p_place = 'salon' then l.longitude else p_lng end
  from (select 1) x
  left join public.locations l on l.business_id = p_business and l.kind = 'salon';
$$;

-- ─── 11. Contrôle des trajets entre rendez-vous (déclencheur) ───────
create or replace function private.appointment_check_travel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.travel_settings%rowtype;
  v_me record;
  v_n record;
  v_nc record;
  v_est public.travel_estimates;
  v_gap numeric;
  v_required integer;
  v_is_member boolean := (select auth.uid()) is not null and private.is_business_member(new.business_id);
begin
  if new.status not in ('pending', 'confirmed') then
    return new;
  end if;
  -- Application d'une tournée : contrôle reporté à la revérification finale (apply_route_plan)
  if coalesce(current_setting('moka.applying_route_plan', true), '') = 'on' then
    return new;
  end if;
  select * into v_s from public.travel_settings where business_id = new.business_id and enabled;
  if not found then
    new.travel_check := 'not_required';
    return new;
  end if;
  if tg_op = 'UPDATE' and new.occupied = old.occupied and new.place = old.place
     and new.latitude is not distinct from old.latitude and new.longitude is not distinct from old.longitude
     and old.status in ('pending', 'confirmed') and new.travel_check = old.travel_check then
    return new;
  end if;

  -- Contournement réservé à la professionnelle (adresse non localisable, service indisponible)
  if new.travel_check = 'skipped_by_pro' then
    if v_is_member then
      return new;
    end if;
    new.travel_check := 'not_required';
  end if;

  select * into v_me from private.stop_coords(new.business_id, new.place, new.latitude, new.longitude);
  if v_me.lat is null then
    if v_is_member then
      new.travel_check := 'skipped_by_pro';
      return new;
    end if;
    raise exception 'MOKA_ADDRESS_NOT_VERIFIED' using errcode = 'P0001',
      hint = 'Adresse non localisée : impossible de vérifier les temps de trajet.';
  end if;

  for v_n in
    (select a.place, a.latitude, a.longitude, upper(a.occupied) as t_end, lower(a.occupied) as t_start, 'prev' as side
       from public.appointments a
      where a.business_id = new.business_id and a.id <> new.id and a.status in ('pending', 'confirmed')
        and upper(a.occupied) <= lower(new.occupied) and upper(a.occupied) > lower(new.occupied) - interval '12 hours'
      order by upper(a.occupied) desc limit 1)
    union all
    (select a.place, a.latitude, a.longitude, upper(a.occupied), lower(a.occupied), 'next'
       from public.appointments a
      where a.business_id = new.business_id and a.id <> new.id and a.status in ('pending', 'confirmed')
        and lower(a.occupied) >= upper(new.occupied) and lower(a.occupied) < upper(new.occupied) + interval '12 hours'
      order by lower(a.occupied) asc limit 1)
  loop
    select * into v_nc from private.stop_coords(new.business_id, v_n.place, v_n.latitude, v_n.longitude);
    if v_nc.lat is null then
      if v_is_member then
        continue; -- rendez-vous voisin saisi sans adresse localisée : vérifié côté application
      end if;
      raise exception 'MOKA_TRAVEL_UNKNOWN' using errcode = 'P0001';
    end if;
    if v_nc.lat = v_me.lat and v_nc.lng = v_me.lng then
      continue;
    end if;
    if v_n.side = 'prev' then
      v_est := private.travel_estimate(new.business_id, v_nc.lat, v_nc.lng, v_me.lat, v_me.lng);
      v_gap := extract(epoch from lower(new.occupied) - v_n.t_end) / 60;
    else
      v_est := private.travel_estimate(new.business_id, v_me.lat, v_me.lng, v_nc.lat, v_nc.lng);
      v_gap := extract(epoch from v_n.t_start - upper(new.occupied)) / 60;
    end if;
    if v_est.id is null then
      raise exception 'MOKA_TRAVEL_UNKNOWN' using errcode = 'P0001',
        hint = 'Temps de trajet non calculé : impossible de vérifier l''enchaînement.';
    end if;
    v_required := ceil(v_est.duration_s / 60.0 * (1 + v_s.safety_margin_pct / 100.0))::integer + v_s.safety_margin_minutes;
    if v_gap < v_required then
      raise exception 'MOKA_TRAVEL_TOO_SHORT' using errcode = 'P0001',
        hint = format('Trajet estimé : %s min avec la marge de sécurité, seulement %s min disponibles.', v_required, floor(v_gap)::integer);
    end if;
  end loop;

  new.travel_check := 'verified';
  return new;
end;
$$;
create trigger appointments_35_travel before insert or update on public.appointments
  for each row execute function private.appointment_check_travel();

-- ─── 12. Frais facturés et zones (mêmes règles que travel-fee.ts) ───
create or replace function private.travel_fee_cents(s public.travel_settings, p_distance_m integer, p_service_cents integer, p_surcharge integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base integer := 0;
  v_billable numeric;
begin
  if s.pricing_mode = 'free' then
    return 0;
  end if;
  if s.pricing_mode = 'free_above' and p_service_cents >= coalesce(s.free_above_cents, 0) then
    return 0;
  end if;
  if s.pricing_mode = 'fixed' or (s.pricing_mode = 'free_above' and s.per_km_cents = 0) then
    v_base := s.fixed_fee_cents;
  elsif s.pricing_mode in ('per_km', 'free_above') then
    v_billable := greatest(0, p_distance_m - s.included_km * 1000);
    v_base := round(v_billable * s.per_km_cents / 1000.0)::integer;
  end if;
  if v_base > 0 then
    v_base := greatest(v_base, s.min_fee_cents);
    if s.max_fee_cents is not null then
      v_base := least(v_base, s.max_fee_cents);
    end if;
  end if;
  return v_base + coalesce(p_surcharge, 0);
end;
$$;

-- Zone : exclusions d'abord, puis première zone incluse correspondante.
create or replace function private.resolve_area(p_business uuid, p_postcode text, p_road_km numeric, p_weekday smallint, p_order_cents integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zone public.service_areas%rowtype;
  v_radius integer;
begin
  if exists (
    select 1 from public.service_areas z
    where z.business_id = p_business and z.is_active and z.excluded
      and ((z.kind = 'postcodes' and p_postcode = any (z.postcodes)) or (z.kind = 'radius' and p_road_km <= z.max_km))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'excluded');
  end if;

  if not exists (select 1 from public.service_areas z where z.business_id = p_business and z.is_active and not z.excluded) then
    select service_radius_km into v_radius from public.business_settings where business_id = p_business;
    if v_radius is not null and p_road_km > v_radius then
      return jsonb_build_object('ok', false, 'reason', 'out_of_area');
    end if;
    return jsonb_build_object('ok', true, 'zone_id', null, 'zone_name', null, 'surcharge_cents', 0);
  end if;

  select * into v_zone from public.service_areas z
  where z.business_id = p_business and z.is_active and not z.excluded
    and ((z.kind = 'postcodes' and p_postcode = any (z.postcodes)) or (z.kind = 'radius' and p_road_km <= z.max_km))
  order by z.position, z.created_at limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'out_of_area');
  end if;
  if v_zone.weekdays is not null and not (p_weekday = any (v_zone.weekdays)) then
    return jsonb_build_object('ok', false, 'reason', 'wrong_day', 'zone_name', v_zone.name);
  end if;
  if p_order_cents < v_zone.min_order_cents then
    return jsonb_build_object('ok', false, 'reason', 'below_minimum', 'zone_name', v_zone.name, 'min_order_cents', v_zone.min_order_cents);
  end if;
  return jsonb_build_object('ok', true, 'zone_id', v_zone.id, 'zone_name', v_zone.name, 'surcharge_cents', v_zone.surcharge_cents);
end;
$$;

-- Coût économique d'un trajet (mêmes règles que travel-cost.ts) : centimes arrondis par poste
create or replace function private.travel_cost(v public.vehicles, p_distance_m integer, p_duration_s integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_km numeric := p_distance_m / 1000.0;
  v_energy integer := 0;
  v_wear integer := 0;
  v_time integer;
  v_other integer;
begin
  if v.id is null then
    return null;
  end if;
  if v.all_in_cost_per_km_millis is not null then
    v_energy := 0;
    v_wear := round(v_km * v.all_in_cost_per_km_millis / 10.0)::integer;
  else
    if v.consumption_per_100km is not null and v.energy_price_millis is not null then
      v_energy := round(v_km * v.consumption_per_100km / 100.0 * v.energy_price_millis / 10.0)::integer;
    end if;
    v_wear := round(v_km * v.wear_cost_per_km_millis / 10.0)::integer;
  end if;
  v_time := round(p_duration_s / 3600.0 * v.hourly_time_cost_cents)::integer;
  v_other := v.fixed_cost_per_trip_cents + v.parking_tolls_per_trip_cents;
  return jsonb_build_object('energy', v_energy, 'wear', v_wear, 'time', v_time, 'other', v_other,
                            'total', v_energy + v_wear + v_time + v_other, 'all_in', v.all_in_cost_per_km_millis is not null);
end;
$$;

revoke all on function private.travel_estimate(uuid, numeric, numeric, numeric, numeric) from public;
revoke all on function private.stop_coords(uuid, public.service_place, numeric, numeric) from public;
revoke all on function private.travel_fee_cents(public.travel_settings, integer, integer, integer) from public;
revoke all on function private.resolve_area(uuid, text, numeric, smallint, integer) from public;
revoke all on function private.travel_cost(public.vehicles, integer, integer) from public;

-- Point de départ des déplacements (coordonnées privées)
create or replace function private.start_coords(p_business uuid, out lat numeric, out lng numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.latitude, l.longitude
  from public.travel_settings s
  join public.locations l on l.business_id = s.business_id
   and l.kind = (case when s.start_point = 'salon' then 'salon' else 'travel_base' end)::public.location_kind
  where s.business_id = p_business;
$$;
revoke all on function private.start_coords(uuid) from public;

-- ─── 13. Lecture serveur (preuve signée, valable 5 minutes) ─────────
-- Message : busy|v1|slug|from_epoch|to_epoch|ts_epoch
-- Renvoie les coordonnées des rendez-vous voisins et du point de départ :
-- uniquement au serveur de l'application (jamais au navigateur).
create or replace function public.server_travel_context(p_slug text, p_from timestamptz, p_to timestamptz, p_ts bigint, p_signature text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := private.bookable_business(p_slug);
  v_start record;
begin
  if not private.signature_ok(concat_ws('|', 'busy', 'v1', lower(btrim(p_slug)), extract(epoch from p_from)::bigint::text,
                                         extract(epoch from p_to)::bigint::text, p_ts::text), p_signature)
     or abs(extract(epoch from now()) - p_ts) > 300 then
    raise exception 'MOKA_BAD_SIGNATURE' using errcode = 'P0001';
  end if;
  if v_business is null then
    return null;
  end if;
  if p_to - p_from > interval '45 days' or p_to <= p_from then
    raise exception 'MOKA_INVALID_RANGE' using errcode = 'P0001';
  end if;
  select * into v_start from private.start_coords(v_business);
  return jsonb_build_object(
    'business_id', v_business,
    'start', case when v_start.lat is not null then jsonb_build_object('lat', v_start.lat, 'lng', v_start.lng) end,
    'salon', (select jsonb_build_object('lat', l.latitude, 'lng', l.longitude) from public.locations l
              where l.business_id = v_business and l.kind = 'salon' and l.latitude is not null),
    'stops', coalesce((
      select jsonb_agg(jsonb_build_object('start', lower(a.occupied), 'end', upper(a.occupied), 'place', a.place,
                                          'lat', c.lat, 'lng', c.lng))
      from public.appointments a
      cross join lateral private.stop_coords(a.business_id, a.place, a.latitude, a.longitude) c
      where a.business_id = v_business and a.status in ('pending', 'confirmed')
        and a.occupied && tstzrange(p_from, p_to, '[)')
    ), '[]'::jsonb)
  );
end;
$$;

-- ─── 14. Page publique : informations tarifaires de déplacement ─────
create or replace function public.public_travel_info(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.enabled, 'pricing_mode', s.pricing_mode, 'fixed_fee_cents', s.fixed_fee_cents,
    'per_km_cents', s.per_km_cents, 'included_km', s.included_km, 'min_fee_cents', s.min_fee_cents,
    'max_fee_cents', s.max_fee_cents, 'free_above_cents', s.free_above_cents,
    'safety_margin_pct', s.safety_margin_pct, 'safety_margin_minutes', s.safety_margin_minutes,
    'version', s.version,
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'kind', z.kind, 'max_km', z.max_km,
                                                           'postcodes', z.postcodes, 'excluded', z.excluded, 'surcharge_cents', z.surcharge_cents,
                                                           'min_order_cents', z.min_order_cents, 'weekdays', z.weekdays) order by z.position, z.created_at)
                       from public.service_areas z where z.business_id = s.business_id and z.is_active), '[]'::jsonb),
    'service_radius_km', (select bs.service_radius_km from public.business_settings bs where bs.business_id = s.business_id)
  )
  from public.travel_settings s
  where s.business_id = private.bookable_business(p_slug);
$$;

-- ─── 15. Création et modification (versions Sprint 5) ───────────────
-- Ajouts : type de ligne (prestation / frais de déplacement), coordonnées,
-- contournement du contrôle des trajets réservé à la professionnelle.
create or replace function public.create_appointment(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business uuid := (p ->> 'business_id')::uuid;
  v_id uuid;
  v_total integer;
  v_deposit integer;
begin
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'MOKA_NO_SERVICE' using errcode = 'P0001', hint = 'Choisissez au moins une prestation.';
  end if;
  perform private.lock_schedule(v_business);

  select coalesce(sum((i ->> 'unit_price_cents')::integer + coalesce((i ->> 'extra_fee_cents')::integer, 0)), 0),
         coalesce(sum(coalesce((i ->> 'deposit_amount_cents')::integer, 0)), 0)
    into v_total, v_deposit
  from jsonb_array_elements(p -> 'items') i;
  v_deposit := least(v_deposit, v_total);

  insert into public.appointments (
    business_id, customer_id, place, status, source, starts_at, duration_minutes, prep_minutes, cleanup_minutes,
    buffer_minutes, address_id, address_line1, address_line2, postal_code, city, notes_internal,
    price_total_cents, deposit_amount_cents, balance_due_cents, latitude, longitude, travel_check
  ) values (
    v_business, (p ->> 'customer_id')::uuid, (p ->> 'place')::public.service_place,
    coalesce((p ->> 'status')::public.appointment_status, 'confirmed'), 'manual',
    (p ->> 'starts_at')::timestamptz, (p ->> 'duration_minutes')::integer,
    coalesce((p ->> 'prep_minutes')::integer, 0), coalesce((p ->> 'cleanup_minutes')::integer, 0),
    coalesce((p ->> 'buffer_minutes')::integer, 0), nullif(p ->> 'address_id', '')::uuid,
    nullif(p ->> 'address_line1', ''), nullif(p ->> 'address_line2', ''), nullif(p ->> 'postal_code', ''),
    nullif(p ->> 'city', ''), nullif(p ->> 'notes_internal', ''),
    v_total, v_deposit, v_total - v_deposit,
    nullif(p ->> 'latitude', '')::numeric, nullif(p ->> 'longitude', '')::numeric,
    case when (p ->> 'skip_travel_check')::boolean then 'skipped_by_pro' else 'not_required' end
  ) returning id into v_id;

  insert into public.appointment_items (
    business_id, appointment_id, service_id, position, service_name, duration_minutes, catalog_price_cents,
    unit_price_cents, price_overridden, extra_fee_cents, vat_rate_bps, price_ht_cents, deposit_type,
    deposit_amount_cents, consumables_cents, products_cents, other_costs_cents, kind
  )
  select v_business, v_id, nullif(i ->> 'service_id', '')::uuid, ord::smallint, i ->> 'service_name',
         (i ->> 'duration_minutes')::integer, (i ->> 'catalog_price_cents')::integer, (i ->> 'unit_price_cents')::integer,
         (i ->> 'unit_price_cents')::integer <> (i ->> 'catalog_price_cents')::integer,
         coalesce((i ->> 'extra_fee_cents')::integer, 0), coalesce((i ->> 'vat_rate_bps')::smallint, 0),
         (i ->> 'price_ht_cents')::integer, coalesce((i ->> 'deposit_type')::public.deposit_type, 'none'),
         coalesce((i ->> 'deposit_amount_cents')::integer, 0), coalesce((i ->> 'consumables_cents')::integer, 0),
         coalesce((i ->> 'products_cents')::integer, 0), coalesce((i ->> 'other_costs_cents')::integer, 0),
         coalesce(nullif(i ->> 'kind', ''), 'service')
  from jsonb_array_elements(p -> 'items') with ordinality as t(i, ord);

  return v_id;
end;
$$;

create or replace function public.update_appointment(p_id uuid, p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_total integer;
  v_deposit integer;
begin
  select * into v_appt from public.appointments where id = p_id;
  if not found then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002', hint = 'Rendez-vous introuvable.';
  end if;
  perform private.lock_schedule(v_appt.business_id);

  if p ? 'items' then
    if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
      raise exception 'MOKA_NO_SERVICE' using errcode = 'P0001', hint = 'Choisissez au moins une prestation.';
    end if;
    delete from public.appointment_items where appointment_id = p_id;
    insert into public.appointment_items (
      business_id, appointment_id, service_id, position, service_name, duration_minutes, catalog_price_cents,
      unit_price_cents, price_overridden, extra_fee_cents, vat_rate_bps, price_ht_cents, deposit_type,
      deposit_amount_cents, consumables_cents, products_cents, other_costs_cents, kind
    )
    select v_appt.business_id, p_id, nullif(i ->> 'service_id', '')::uuid, ord::smallint, i ->> 'service_name',
           (i ->> 'duration_minutes')::integer, (i ->> 'catalog_price_cents')::integer, (i ->> 'unit_price_cents')::integer,
           (i ->> 'unit_price_cents')::integer <> (i ->> 'catalog_price_cents')::integer,
           coalesce((i ->> 'extra_fee_cents')::integer, 0), coalesce((i ->> 'vat_rate_bps')::smallint, 0),
           (i ->> 'price_ht_cents')::integer, coalesce((i ->> 'deposit_type')::public.deposit_type, 'none'),
           coalesce((i ->> 'deposit_amount_cents')::integer, 0), coalesce((i ->> 'consumables_cents')::integer, 0),
           coalesce((i ->> 'products_cents')::integer, 0), coalesce((i ->> 'other_costs_cents')::integer, 0),
           coalesce(nullif(i ->> 'kind', ''), 'service')
    from jsonb_array_elements(p -> 'items') with ordinality as t(i, ord);
  end if;

  select coalesce(sum(unit_price_cents + extra_fee_cents), 0), coalesce(sum(deposit_amount_cents), 0)
    into v_total, v_deposit
  from public.appointment_items where appointment_id = p_id;
  v_deposit := least(v_deposit, v_total);

  update public.appointments set
    customer_id = coalesce((p ->> 'customer_id')::uuid, customer_id),
    place = coalesce((p ->> 'place')::public.service_place, place),
    starts_at = coalesce((p ->> 'starts_at')::timestamptz, starts_at),
    duration_minutes = coalesce((p ->> 'duration_minutes')::integer, duration_minutes),
    prep_minutes = coalesce((p ->> 'prep_minutes')::integer, prep_minutes),
    cleanup_minutes = coalesce((p ->> 'cleanup_minutes')::integer, cleanup_minutes),
    buffer_minutes = coalesce((p ->> 'buffer_minutes')::integer, buffer_minutes),
    address_id = case when p ? 'address_line1' then nullif(p ->> 'address_id', '')::uuid else address_id end,
    address_line1 = case when p ? 'address_line1' then nullif(p ->> 'address_line1', '') else address_line1 end,
    address_line2 = case when p ? 'address_line1' then nullif(p ->> 'address_line2', '') else address_line2 end,
    postal_code = case when p ? 'address_line1' then nullif(p ->> 'postal_code', '') else postal_code end,
    city = case when p ? 'address_line1' then nullif(p ->> 'city', '') else city end,
    latitude = case when p ? 'latitude' then nullif(p ->> 'latitude', '')::numeric else latitude end,
    longitude = case when p ? 'latitude' then nullif(p ->> 'longitude', '')::numeric else longitude end,
    travel_check = case when (p ->> 'skip_travel_check')::boolean then 'skipped_by_pro'
                        when p ? 'skip_travel_check' then 'not_required' else travel_check end,
    notes_internal = case when p ? 'notes_internal' then nullif(p ->> 'notes_internal', '') else notes_internal end,
    price_total_cents = v_total,
    deposit_amount_cents = v_deposit,
    balance_due_cents = v_total - v_deposit
  where id = p_id;
  if not found then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002', hint = 'Rendez-vous introuvable.';
  end if;
end;
$$;

-- ─── 16. Réservation publique : version Sprint 5 ────────────────────
-- Ajout pour le domicile quand les déplacements sont activés : adresse
-- géocodée SIGNÉE (geo), zone, frais recalculés par la base, ligne
-- « Frais de déplacement », instantané du trajet. Sinon : identique au Sprint 4.
-- Message geo signé : geo|v1|business|lat|lng|postcode|expires_epoch
create or replace function private.verify_geo(p_business uuid, g jsonb, out lat numeric, out lng numeric, out postcode text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exp bigint;
begin
  begin
    lat := round((g ->> 'lat')::numeric, 6);
    lng := round((g ->> 'lng')::numeric, 6);
    postcode := g ->> 'postcode';
    v_exp := (g ->> 'expires_epoch')::bigint;
  exception when others then
    raise exception 'MOKA_ADDRESS_NOT_VERIFIED' using errcode = 'P0001';
  end;
  if lat is null or not private.signature_ok(concat_ws('|', 'geo', 'v1', p_business::text, private.coord(lat), private.coord(lng),
                                                        coalesce(postcode, ''), v_exp::text), g ->> 'signature')
     or to_timestamp(v_exp) < now() then
    raise exception 'MOKA_ADDRESS_NOT_VERIFIED' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.verify_geo(uuid, jsonb) from public;

create or replace function public.public_create_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := private.bookable_business(p ->> 'slug');
  v_settings public.business_settings%rowtype;
  v_travel public.travel_settings%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_service public.services%rowtype;
  v_place public.service_place;
  v_place_price integer;
  v_start timestamptz;
  v_range tstzrange;
  v_total integer;
  v_fee integer := 0;
  v_first text := btrim(coalesce(p ->> 'first_name', ''));
  v_last text := btrim(coalesce(p ->> 'last_name', ''));
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_phone_norm text;
  v_line1 text := nullif(btrim(coalesce(p ->> 'address_line1', '')), '');
  v_line2 text := nullif(btrim(coalesce(p ->> 'address_line2', '')), '');
  v_postal text := nullif(btrim(coalesce(p ->> 'postal_code', '')), '');
  v_city text := nullif(btrim(coalesce(p ->> 'city', '')), '');
  v_comment text := nullif(btrim(coalesce(p ->> 'comment', '')), '');
  v_key uuid;
  v_hash text := p ->> 'token_hash';
  v_customer uuid;
  v_address uuid;
  v_appointment uuid;
  v_costs record;
  v_lat numeric;
  v_lng numeric;
  v_geo_postcode text;
  v_origin record;
  v_est public.travel_estimates;
  v_area jsonb;
  v_cost jsonb;
  v_tz text;
  v_travel_on boolean := false;
begin
  if v_business is null then
    raise exception 'MOKA_BOOKING_UNAVAILABLE' using errcode = 'P0001';
  end if;
  select * into v_settings from public.business_settings where business_id = v_business;
  select * into v_travel from public.travel_settings where business_id = v_business;
  v_travel_on := coalesce(v_travel.enabled, false);

  begin
    v_key := (p ->> 'idempotency_key')::uuid;
    v_place := (p ->> 'place')::public.service_place;
    v_start := (p ->> 'starts_at')::timestamptz;
  exception when others then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end;
  if v_key is null or v_place is null or v_start is null or v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;
  if coalesce((p ->> 'accept_terms')::boolean, false) is not true then
    raise exception 'MOKA_TERMS_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_first) not between 1 and 80 or char_length(v_last) not between 1 and 80 then
    raise exception 'MOKA_INVALID_NAME' using errcode = 'P0001';
  end if;
  if char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'MOKA_INVALID_EMAIL' using errcode = 'P0001';
  end if;
  v_phone_norm := private.normalize_phone(v_phone);
  if char_length(v_phone) > 30 or v_phone_norm is null or char_length(v_phone_norm) not between 9 and 15 then
    raise exception 'MOKA_INVALID_PHONE' using errcode = 'P0001';
  end if;
  if v_comment is not null and char_length(v_comment) > 1000 then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;
  if v_place = 'home' then
    if v_line1 is null or char_length(v_line1) > 200 or coalesce(char_length(v_line2), 0) > 200
       or v_postal is null or v_postal !~ '^[0-9]{5}$'
       or v_city is null or char_length(v_city) > 100 then
      raise exception 'MOKA_INVALID_ADDRESS' using errcode = 'P0001';
    end if;
  else
    v_line1 := null; v_line2 := null; v_postal := null; v_city := null;
  end if;

  select sv.* into v_service from public.services sv
  left join public.service_categories c on c.id = sv.category_id
  where sv.id = nullif(p ->> 'service_id', '')::uuid and sv.business_id = v_business
    and sv.is_active and sv.online_bookable and sv.archived_at is null
    and (sv.category_id is null or (c.archived_at is null and c.is_visible));
  if not found then
    raise exception 'MOKA_SERVICE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if v_service.deposit_type <> 'none' then
    raise exception 'MOKA_DEPOSIT_REQUIRED' using errcode = 'P0001';
  end if;
  select sl.price_cents into v_place_price from public.service_locations sl
  where sl.service_id = v_service.id and sl.place = v_place;
  if not found then
    raise exception 'MOKA_PLACE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_total := private.service_total_cents(v_service, v_place_price);

  if v_start < now() + make_interval(mins => v_service.min_notice_minutes) then
    raise exception 'MOKA_TOO_LATE' using errcode = 'P0001';
  end if;
  if v_start > now() + make_interval(days => v_settings.booking_window_days) then
    raise exception 'MOKA_TOO_FAR' using errcode = 'P0001';
  end if;
  if extract(second from v_start) <> 0 or extract(minute from v_start)::integer % 5 <> 0 then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Déplacement : adresse vérifiée, zone, frais (recalculés ici, jamais reçus du navigateur)
  if v_place = 'home' and v_travel_on then
    select g.lat, g.lng, g.postcode into v_lat, v_lng, v_geo_postcode from private.verify_geo(v_business, p -> 'geo') g;
    if v_geo_postcode is distinct from v_postal then
      raise exception 'MOKA_ADDRESS_MISMATCH' using errcode = 'P0001';
    end if;
    select * into v_origin from private.start_coords(v_business);
    if v_origin.lat is null then
      raise exception 'MOKA_TRAVEL_UNKNOWN' using errcode = 'P0001';
    end if;
    v_est := private.travel_estimate(v_business, v_origin.lat, v_origin.lng, v_lat, v_lng);
    if v_est.id is null then
      raise exception 'MOKA_TRAVEL_UNKNOWN' using errcode = 'P0001';
    end if;
    v_tz := coalesce(v_settings.timezone, 'Europe/Paris');
    v_area := private.resolve_area(v_business, v_geo_postcode, v_est.distance_m / 1000.0,
                                   extract(isodow from v_start at time zone v_tz)::smallint, v_total);
    if not (v_area ->> 'ok')::boolean then
      raise exception '%', case v_area ->> 'reason'
        when 'excluded' then 'MOKA_OUT_OF_AREA' when 'out_of_area' then 'MOKA_OUT_OF_AREA'
        when 'wrong_day' then 'MOKA_AREA_WRONG_DAY' else 'MOKA_AREA_MINIMUM' end
        using errcode = 'P0001';
    end if;
    v_fee := private.travel_fee_cents(v_travel, v_est.distance_m, v_total, coalesce((v_area ->> 'surcharge_cents')::integer, 0));
  end if;

  perform private.lock_schedule(v_business);

  select a.id into v_appointment from public.appointments a
  where a.business_id = v_business and a.idempotency_key = v_key;
  if found then
    return jsonb_build_object('appointment_id', v_appointment, 'duplicate', true, 'notifications', '[]'::jsonb);
  end if;

  if (select count(*) from public.appointments a
      where a.business_id = v_business and a.source = 'online' and a.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'MOKA_RATE_LIMITED' using errcode = 'P0001';
  end if;
  if (select count(*) from public.appointments a
      join public.customers c on c.id = a.customer_id
      where a.business_id = v_business and a.source = 'online' and a.created_at > now() - interval '24 hours'
        and (c.email_normalized = v_email or c.phone_normalized = v_phone_norm)) >= 3 then
    raise exception 'MOKA_RATE_LIMITED' using errcode = 'P0001';
  end if;

  v_range := tstzrange(
    v_start - make_interval(mins => v_service.prep_minutes),
    v_start + make_interval(mins => v_service.duration_minutes + v_service.cleanup_minutes + v_service.buffer_minutes),
    '[)'
  );
  if private.overlaps_active_hold(v_business, v_range) then
    raise exception 'MOKA_SLOT_TAKEN' using errcode = 'P0001';
  end if;

  select c.id into v_customer from public.customers c
  where c.business_id = v_business and c.archived_at is null and c.email_normalized = v_email
  order by c.created_at limit 1;
  if v_customer is null then
    select c.id into v_customer from public.customers c
    where c.business_id = v_business and c.archived_at is null and c.phone_normalized = v_phone_norm
    order by c.created_at limit 1;
  end if;
  if v_customer is null then
    insert into public.customers (business_id, first_name, last_name, email, phone, source)
    values (v_business, v_first, v_last, v_email, v_phone, 'booking')
    returning id into v_customer;
  else
    update public.customers set
      email = coalesce(email, v_email),
      phone = coalesce(nullif(btrim(phone), ''), v_phone)
    where id = v_customer and (email is null or nullif(btrim(phone), '') is null);
  end if;

  if v_place = 'home' then
    select ad.id into v_address from public.customer_addresses ad
    where ad.customer_id = v_customer
      and lower(btrim(ad.line1)) = lower(v_line1)
      and coalesce(ad.postal_code, '') = v_postal
      and lower(btrim(ad.city)) = lower(v_city)
    limit 1;
    if v_address is null then
      insert into public.customer_addresses (business_id, customer_id, kind, line1, line2, postal_code, city, is_primary,
                                             latitude, longitude, geocoded_at, geocode_source)
      values (v_business, v_customer, 'home', v_line1, v_line2, v_postal, v_city,
              not exists (select 1 from public.customer_addresses x where x.customer_id = v_customer and x.is_primary),
              v_lat, v_lng, case when v_lat is not null then now() end, case when v_lat is not null then 'ign' end)
      returning id into v_address;
    elsif v_lat is not null then
      update public.customer_addresses set latitude = v_lat, longitude = v_lng, geocoded_at = now(), geocode_source = 'ign'
      where id = v_address and latitude is null;
    end if;
  end if;

  begin
    insert into public.appointments (
      business_id, customer_id, place, status, source, starts_at, duration_minutes, prep_minutes,
      cleanup_minutes, buffer_minutes, address_id, address_line1, address_line2, postal_code, city,
      price_total_cents, deposit_amount_cents, balance_due_cents, customer_comment, conditions_snapshot,
      idempotency_key, public_token_hash, latitude, longitude
    ) values (
      v_business, v_customer, v_place, 'confirmed', 'online', v_start, v_service.duration_minutes,
      v_service.prep_minutes, v_service.cleanup_minutes, v_service.buffer_minutes, v_address,
      v_line1, v_line2, v_postal, v_city, v_total + v_fee, 0, v_total + v_fee, v_comment,
      jsonb_build_object(
        'cancellation_notice_hours', v_settings.cancellation_notice_hours,
        'customer_can_cancel', v_settings.customer_can_cancel,
        'customer_can_reschedule', v_settings.customer_can_reschedule,
        'cancellation_policy', v_settings.cancellation_policy,
        'booking_terms', v_settings.booking_terms,
        'terms_accepted_at', now(),
        'customer_name', v_first || ' ' || v_last,
        'customer_email', v_email,
        'customer_phone', v_phone
      ),
      v_key, v_hash, v_lat, v_lng
    ) returning id into v_appointment;
  exception
    when exclusion_violation then
      raise exception 'MOKA_SLOT_TAKEN' using errcode = 'P0001';
    when unique_violation then
      raise exception 'MOKA_DUPLICATE' using errcode = 'P0001';
  end;

  select
    coalesce(sum(amount_cents) filter (where kind = 'consumables'), 0) as consumables,
    coalesce(sum(amount_cents) filter (where kind = 'products'), 0) as products,
    coalesce(sum(amount_cents) filter (where kind = 'other'), 0) as other
  into v_costs
  from public.service_costs where service_id = v_service.id;

  insert into public.appointment_items (
    business_id, appointment_id, service_id, position, service_name, duration_minutes, catalog_price_cents,
    unit_price_cents, price_overridden, extra_fee_cents, vat_rate_bps, price_ht_cents, deposit_type,
    deposit_amount_cents, consumables_cents, products_cents, other_costs_cents
  ) values (
    v_business, v_appointment, v_service.id, 1, v_service.name, v_service.duration_minutes, v_total,
    v_total, false, 0, v_service.vat_rate_bps,
    case when v_service.vat_rate_bps > 0 then round(v_total * 10000.0 / (10000 + v_service.vat_rate_bps))::integer else v_total end,
    'none', 0, v_costs.consumables, v_costs.products, v_costs.other
  );

  if v_place = 'home' and v_travel_on then
    if v_fee > 0 then
      insert into public.appointment_items (
        business_id, appointment_id, service_id, position, service_name, duration_minutes, catalog_price_cents,
        unit_price_cents, price_overridden, extra_fee_cents, vat_rate_bps, price_ht_cents, deposit_type,
        deposit_amount_cents, kind
      ) values (
        v_business, v_appointment, null, 2, 'Frais de déplacement', 5, v_fee, v_fee, false, 0, v_travel.fee_vat_rate_bps,
        case when v_travel.fee_vat_rate_bps > 0 then round(v_fee * 10000.0 / (10000 + v_travel.fee_vat_rate_bps))::integer else v_fee end,
        'none', 0, 'travel_fee'
      );
    end if;
    select * into v_vehicle from public.vehicles where business_id = v_business and is_default and archived_at is null;
    v_cost := private.travel_cost(v_vehicle, v_est.distance_m, v_est.duration_s);
    insert into public.appointment_travel (appointment_id, business_id, distance_meters, duration_minutes, fee_cents, origin, source,
      computed_at, vehicle_id, vehicle_snapshot, settings_version, zone_name, fee_vat_rate_bps,
      energy_cost_cents, wear_cost_cents, time_cost_cents, other_cost_cents, economic_cost_cents)
    values (v_appointment, v_business, v_est.distance_m, ceil(v_est.duration_s / 60.0)::integer, v_fee,
      case when v_travel.start_point = 'salon' then 'salon' else 'travel_base' end, v_est.provider, v_est.computed_at,
      v_vehicle.id, case when v_vehicle.id is not null then to_jsonb(v_vehicle) - 'business_id' end,
      v_travel.version, v_area ->> 'zone_name', v_travel.fee_vat_rate_bps,
      (v_cost ->> 'energy')::integer, (v_cost ->> 'wear')::integer, (v_cost ->> 'time')::integer,
      (v_cost ->> 'other')::integer, (v_cost ->> 'total')::integer);
  end if;

  return jsonb_build_object(
    'appointment_id', v_appointment,
    'duplicate', false,
    'travel_fee_cents', v_fee,
    'notifications', private.queue_booking_notifications(v_appointment, 'confirmed')
  );
end;
$$;

-- ─── 17. Droits d'exécution ─────────────────────────────────────────
revoke all on function public.record_travel_estimate(jsonb) from public;
revoke all on function public.server_travel_context(text, timestamptz, timestamptz, bigint, text) from public;
revoke all on function public.public_travel_info(text) from public;
grant execute on function public.record_travel_estimate(jsonb) to anon, authenticated;
grant execute on function public.server_travel_context(text, timestamptz, timestamptz, bigint, text) to anon, authenticated;
grant execute on function public.public_travel_info(text) to anon, authenticated;

-- ─── 18. Appliquer une tournée optimisée (validation de la professionnelle) ─
-- Les rendez-vous peuvent échanger leurs horaires : la contrainte anti-
-- chevauchement est vérifiée en fin de transaction, puis CHAQUE trajet est
-- revérifié une fois tous les horaires en place. Tout ou rien.
alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap exclude using gist (
  business_id extensions.gist_uuid_ops with =,
  occupied with &&
) where (status in ('pending', 'confirmed')) deferrable initially immediate;

create or replace function public.apply_route_plan(p_plan_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.route_plans%rowtype;
  v_stop record;
  v_ids uuid[] := '{}';
  v_count integer := 0;
begin
  select * into v_plan from public.route_plans where id = p_plan_id for update;
  if not found then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'proposed' then
    raise exception 'MOKA_PLAN_CLOSED' using errcode = 'P0001';
  end if;
  perform private.lock_schedule(v_plan.business_id);

  -- La tournée doit correspondre exactement à l'agenda actuel
  if exists (
    select 1 from public.route_plan_stops s join public.appointments a on a.id = s.appointment_id
    where s.route_plan_id = p_plan_id and (a.starts_at <> s.current_starts_at or a.status not in ('pending', 'confirmed'))
  ) then
    raise exception 'MOKA_PLAN_OUTDATED' using errcode = 'P0001';
  end if;

  set constraints public.appointments_no_overlap deferred;
  perform set_config('moka.applying_route_plan', 'on', true);
  for v_stop in select * from public.route_plan_stops where route_plan_id = p_plan_id and proposed_starts_at <> current_starts_at loop
    update public.appointments set starts_at = v_stop.proposed_starts_at where id = v_stop.appointment_id;
    v_ids := v_ids || v_stop.appointment_id;
    v_count := v_count + 1;
  end loop;
  perform set_config('moka.applying_route_plan', 'off', true);

  -- Revérification complète des trajets avec les nouveaux horaires
  update public.appointments set travel_check = case when travel_check = 'verified' then 'not_required' else 'verified' end
  where id = any (v_ids);
  set constraints public.appointments_no_overlap immediate;

  update public.route_plans set status = 'applied', updated_at = now() where id = p_plan_id;
  return v_count;
end;
$$;
revoke all on function public.apply_route_plan(uuid) from public, anon;
grant execute on function public.apply_route_plan(uuid) to authenticated;

-- ─── 19. Coordonnées du rendez-vous pour le lien secret (déplacement) ──
-- Uniquement l'adresse de la cliente qui détient le lien (déjà la sienne).
create or replace function public.public_booking_coords(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('place', a.place, 'lat', c.lat, 'lng', c.lng)
  from public.appointments a
  cross join lateral private.stop_coords(a.business_id, a.place, a.latitude, a.longitude) c
  where p_token_hash ~ '^[0-9a-f]{64}$' and a.public_token_hash = p_token_hash;
$$;
revoke all on function public.public_booking_coords(text) from public;
grant execute on function public.public_booking_coords(text) to anon, authenticated;
