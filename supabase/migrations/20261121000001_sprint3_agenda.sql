-- ════════════════════════════════════════════════════════════════════
-- Moka Réservation — Sprint 3 — Agenda et disponibilités
-- Tables : availability_rules, availability_exceptions, appointments,
--          appointment_items, booking_events, appointment_travel, booking_holds
-- Garanties PostgreSQL :
--  • deux rendez-vous actifs ne peuvent pas se chevaucher (contrainte
--    d'exclusion), y compris en cas de réservations simultanées ;
--  • un rendez-vous actif doit tenir entièrement dans une plage horaire
--    (pauses, durées trop longues et jours fermés refusés) et ne pas
--    toucher un congé / une fermeture / une indisponibilité ;
--  • calculs dans le fuseau horaire de l'entreprise (changements d'heure gérés) ;
--  • transitions de statut contrôlées et historisées automatiquement.
-- Hypothèse V1 : un seul agenda par entreprise (la professionnelle).
-- ════════════════════════════════════════════════════════════════════

create extension if not exists btree_gist with schema extensions;

create type public.availability_exception_kind as enum ('vacation', 'closure', 'unavailable');
create type public.appointment_source as enum ('manual', 'online');

-- Les adresses clientes doivent pouvoir être référencées avec leur entreprise
alter table public.customer_addresses add constraint customer_addresses_id_business_key unique (id, business_id);

-- ════════════════════════════════════════════════════════════════════
-- DISPONIBILITÉS
-- ════════════════════════════════════════════════════════════════════

-- Plages de travail hebdomadaires. Une pause = l'intervalle entre deux plages.
-- place NULL = domicile et institut ; sinon plage réservée à un mode.
create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- 1 = lundi … 7 = dimanche (ISO)
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  place public.service_place,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_rules_order check (end_minute > start_minute),
  constraint availability_rules_no_overlap exclude using gist (
    business_id extensions.gist_uuid_ops with =,
    weekday extensions.gist_int2_ops with =,
    int4range(start_minute, end_minute) with &&
  )
);
create index availability_rules_business_idx on public.availability_rules (business_id, weekday);

-- Congés, fermetures exceptionnelles, indisponibilités ponctuelles
create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind public.availability_exception_kind not null,
  label text check (char_length(label) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  place public.service_place, -- NULL = bloque domicile et institut
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_exceptions_order check (ends_at > starts_at),
  constraint availability_exceptions_max_length check (ends_at - starts_at <= interval '366 days')
);
create index availability_exceptions_business_idx on public.availability_exceptions (business_id, starts_at);

-- ════════════════════════════════════════════════════════════════════
-- RENDEZ-VOUS
-- ════════════════════════════════════════════════════════════════════

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null,
  place public.service_place not null,
  status public.appointment_status not null default 'confirmed',
  source public.appointment_source not null default 'manual',
  -- Horaire de la prestation (starts_at → ends_at) et temps bloqué
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  prep_minutes integer not null default 0 check (prep_minutes between 0 and 240),
  cleanup_minutes integer not null default 0 check (cleanup_minutes between 0 and 240),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 240),
  ends_at timestamptz not null,       -- calculé : starts_at + durée
  occupied tstzrange not null,        -- calculé : préparation → nettoyage + tampon
  -- Adresse d'intervention (copie figée ; lien facultatif vers l'adresse de la fiche)
  address_id uuid,
  address_line1 text check (char_length(address_line1) <= 200),
  address_line2 text check (char_length(address_line2) <= 200),
  postal_code text check (char_length(postal_code) <= 12),
  city text check (char_length(city) <= 100),
  -- Montants figés (centimes TTC)
  price_total_cents integer not null default 0 check (price_total_cents between 0 and 100000000),
  deposit_amount_cents integer not null default 0 check (deposit_amount_cents >= 0),
  balance_due_cents integer not null default 0 check (balance_due_cents >= 0),
  payment_status public.payment_status not null default 'unpaid',
  notes_internal text check (char_length(notes_internal) <= 2000),
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (customer_id, business_id) references public.customers (id, business_id),
  foreign key (address_id, business_id) references public.customer_addresses (id, business_id) on delete set null (address_id),
  constraint appointments_home_address check (place <> 'home' or (address_line1 is not null and city is not null)),
  constraint appointments_amounts check (deposit_amount_cents <= price_total_cents and balance_due_cents = price_total_cents - deposit_amount_cents),
  -- Aucun chevauchement entre rendez-vous actifs (garanti même en concurrence)
  constraint appointments_no_overlap exclude using gist (
    business_id extensions.gist_uuid_ops with =,
    occupied with &&
  ) where (status in ('pending', 'confirmed'))
);
create index appointments_business_start_idx on public.appointments (business_id, starts_at);
create index appointments_customer_idx on public.appointments (business_id, customer_id, starts_at);

-- Prestations du rendez-vous : instantané du catalogue au moment de la réservation
-- (prix, durées, TVA, acompte, coûts). Une prestation archivée reste identifiable
-- grâce à service_name, même si le catalogue change ensuite.
create table public.appointment_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  appointment_id uuid not null,
  service_id uuid,
  position smallint not null default 1 check (position between 1 and 20),
  service_name text not null check (char_length(btrim(service_name)) between 1 and 120),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  catalog_price_cents integer not null check (catalog_price_cents >= 0),
  unit_price_cents integer not null check (unit_price_cents between 0 and 10000000),
  price_overridden boolean not null default false,
  extra_fee_cents integer not null default 0 check (extra_fee_cents >= 0),
  vat_rate_bps smallint not null default 0 check (vat_rate_bps in (0, 550, 1000, 2000)),
  price_ht_cents integer not null check (price_ht_cents >= 0),
  deposit_type public.deposit_type not null default 'none',
  deposit_amount_cents integer not null default 0 check (deposit_amount_cents >= 0),
  -- Instantané des coûts directs (base des futures analyses financières)
  consumables_cents integer not null default 0 check (consumables_cents >= 0),
  products_cents integer not null default 0 check (products_cents >= 0),
  other_costs_cents integer not null default 0 check (other_costs_cents >= 0),
  created_at timestamptz not null default now(),
  unique (appointment_id, position),
  foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade,
  foreign key (service_id, business_id) references public.services (id, business_id)
);
create index appointment_items_business_idx on public.appointment_items (business_id, appointment_id);
create index appointment_items_service_idx on public.appointment_items (business_id, service_id);

-- Historique des changements (écrit uniquement par la base)
create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  appointment_id uuid not null,
  event_type text not null check (event_type in ('created', 'updated', 'rescheduled', 'status_changed', 'cancelled')),
  from_status public.appointment_status,
  to_status public.appointment_status,
  old_starts_at timestamptz,
  new_starts_at timestamptz,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade
);
create index booking_events_appointment_idx on public.booking_events (business_id, appointment_id, created_at);

-- Préparé pour le Sprint 5 (trajets) : rien n'est calculé ni inventé ici
create table public.appointment_travel (
  appointment_id uuid primary key,
  business_id uuid not null,
  distance_meters integer check (distance_meters >= 0),
  duration_minutes integer check (duration_minutes between 0 and 600),
  fee_cents integer check (fee_cents >= 0),
  origin text check (origin in ('travel_base', 'previous_appointment')),
  source text check (char_length(source) <= 40),
  computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade,
  constraint appointment_travel_computed check ((distance_meters is null and duration_minutes is null) or computed_at is not null)
);

-- Préparé pour le Sprint 4 (réservation en ligne) : blocage temporaire d'un créneau
-- pendant le paiement de l'acompte. Accès serveur uniquement (aucune politique).
create table public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  place public.service_place not null,
  occupied tstzrange not null,
  service_id uuid,
  token_hash text not null unique check (char_length(token_hash) between 32 and 128),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (service_id, business_id) references public.services (id, business_id) on delete cascade
);
create index booking_holds_business_idx on public.booking_holds (business_id, expires_at);

-- ════════════════════════════════════════════════════════════════════
-- DÉCLENCHEURS
-- ════════════════════════════════════════════════════════════════════

-- 10 · Horaires calculés
create or replace function private.appointment_compute_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_minutes);
  new.occupied := tstzrange(
    new.starts_at - make_interval(mins => new.prep_minutes),
    new.ends_at + make_interval(mins => new.cleanup_minutes + new.buffer_minutes),
    '[)'
  );
  if new.status = 'cancelled' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

-- 20 · Règles de statut
--   en attente → confirmé | annulé
--   confirmé   → terminé | annulé | cliente absente
--   terminé / annulé / absente : définitifs (horaires figés)
--   terminé et absente uniquement pour un rendez-vous déjà commencé
create or replace function private.appointment_check_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('completed', 'no_show', 'cancelled') and new.starts_at > now() then
      raise exception 'MOKA_STATUS_NOT_ALLOWED' using errcode = 'P0001', hint = 'Un rendez-vous futur ne peut pas être créé terminé, annulé ou absent.';
    end if;
    return new;
  end if;

  if old.status in ('completed', 'cancelled', 'no_show') then
    if new.status <> old.status
       or new.starts_at <> old.starts_at
       or new.duration_minutes <> old.duration_minutes
       or new.place <> old.place then
      raise exception 'MOKA_APPOINTMENT_LOCKED' using errcode = 'P0001', hint = 'Ce rendez-vous est clôturé et ne peut plus être modifié.';
    end if;
    return new;
  end if;

  if new.status <> old.status then
    if not (
      (old.status = 'pending' and new.status in ('confirmed', 'cancelled'))
      or (old.status = 'confirmed' and new.status in ('completed', 'cancelled', 'no_show'))
    ) then
      raise exception 'MOKA_STATUS_TRANSITION' using errcode = 'P0001', hint = format('Passage de « %s » à « %s » non autorisé.', old.status, new.status);
    end if;
    if new.status in ('completed', 'no_show') and new.starts_at > now() then
      raise exception 'MOKA_STATUS_NOT_ALLOWED' using errcode = 'P0001', hint = 'Ce rendez-vous n''a pas encore eu lieu.';
    end if;
  end if;
  return new;
end;
$$;

-- 30 · Disponibilités (dans le fuseau horaire de l'entreprise)
create or replace function private.appointment_check_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_dow smallint;
  v_start_min integer;
  v_end_min integer;
begin
  if new.status not in ('pending', 'confirmed') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.occupied = old.occupied
     and new.place = old.place
     and old.status in ('pending', 'confirmed') then
    return new; -- rien qui touche aux horaires
  end if;

  select coalesce(s.timezone, 'Europe/Paris') into v_tz
  from public.business_settings s where s.business_id = new.business_id;
  v_tz := coalesce(v_tz, 'Europe/Paris');

  v_local_start := lower(new.occupied) at time zone v_tz;
  v_local_end := upper(new.occupied) at time zone v_tz;

  if v_local_end::date > v_local_start::date
     and not (v_local_end::date = v_local_start::date + 1 and v_local_end::time = time '00:00') then
    raise exception 'MOKA_OUTSIDE_HOURS' using errcode = 'P0001', hint = 'Le rendez-vous ne peut pas s''étendre sur deux journées.';
  end if;

  v_dow := extract(isodow from v_local_start)::smallint;
  v_start_min := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  v_end_min := case when v_local_end::date > v_local_start::date then 1440
                    else extract(hour from v_local_end)::integer * 60 + extract(minute from v_local_end)::integer end;
  if extract(second from v_local_end) > 0 and v_end_min < 1440 then
    v_end_min := v_end_min + 1;
  end if;

  -- Le temps bloqué (préparation → tampon) doit tenir dans UNE plage compatible avec le lieu
  if not exists (
    select 1 from public.availability_rules r
    where r.business_id = new.business_id
      and r.weekday = v_dow
      and r.start_minute <= v_start_min
      and r.end_minute >= v_end_min
      and (r.place is null or r.place = new.place)
  ) then
    raise exception 'MOKA_OUTSIDE_HOURS' using errcode = 'P0001',
      hint = 'En dehors de vos horaires pour ce lieu, pendant une pause, ou durée dépassant la plage.';
  end if;

  if exists (
    select 1 from public.availability_exceptions e
    where e.business_id = new.business_id
      and tstzrange(e.starts_at, e.ends_at, '[)') && new.occupied
      and (e.place is null or e.place = new.place)
  ) then
    raise exception 'MOKA_BLOCKED_PERIOD' using errcode = 'P0001', hint = 'Période bloquée (congé, fermeture ou indisponibilité).';
  end if;

  return new;
end;
$$;

create trigger appointments_10_compute before insert or update on public.appointments
  for each row execute function private.appointment_compute_times();
create trigger appointments_20_status before insert or update on public.appointments
  for each row execute function private.appointment_check_status();
create trigger appointments_30_availability before insert or update on public.appointments
  for each row execute function private.appointment_check_availability();
create trigger appointments_audit before insert or update on public.appointments
  for each row execute function private.audit_row();

-- Historique automatique
create or replace function private.appointment_log_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    v_type := 'created';
  elsif new.status <> old.status then
    v_type := case when new.status = 'cancelled' then 'cancelled' else 'status_changed' end;
  elsif new.starts_at <> old.starts_at then
    v_type := 'rescheduled';
  else
    v_type := 'updated';
  end if;

  insert into public.booking_events (business_id, appointment_id, event_type, from_status, to_status, old_starts_at, new_starts_at, actor_id)
  values (
    new.business_id, new.id, v_type,
    case when tg_op = 'UPDATE' then old.status end, new.status,
    case when tg_op = 'UPDATE' then old.starts_at end, new.starts_at,
    (select auth.uid())
  );
  return null;
end;
$$;

create trigger appointments_log after insert or update on public.appointments
  for each row execute function private.appointment_log_event();

create trigger availability_rules_updated before update on public.availability_rules
  for each row execute function private.lock_business_id();
create trigger availability_exceptions_updated before update on public.availability_exceptions
  for each row execute function private.lock_business_id();
create trigger appointment_travel_updated before update on public.appointment_travel
  for each row execute function private.lock_business_id();

-- ════════════════════════════════════════════════════════════════════
-- CRÉATION / MODIFICATION ATOMIQUES (soumises à la RLS de l'appelante)
-- Un verrou transactionnel par entreprise sérialise les réservations
-- simultanées ; la contrainte d'exclusion reste la garantie finale.
-- ════════════════════════════════════════════════════════════════════

create or replace function private.lock_schedule(p_business_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text, 7071));
$$;
grant execute on function private.lock_schedule(uuid) to authenticated;

-- p : { business_id, customer_id, place, status, starts_at, duration_minutes, prep_minutes,
--       cleanup_minutes, buffer_minutes, address_id, address_line1, address_line2, postal_code,
--       city, notes_internal, items: [ { service_id, service_name, duration_minutes,
--       catalog_price_cents, unit_price_cents, extra_fee_cents, vat_rate_bps, price_ht_cents,
--       deposit_type, deposit_amount_cents, consumables_cents, products_cents, other_costs_cents } ] }
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
    price_total_cents, deposit_amount_cents, balance_due_cents
  ) values (
    v_business, (p ->> 'customer_id')::uuid, (p ->> 'place')::public.service_place,
    coalesce((p ->> 'status')::public.appointment_status, 'confirmed'), 'manual',
    (p ->> 'starts_at')::timestamptz, (p ->> 'duration_minutes')::integer,
    coalesce((p ->> 'prep_minutes')::integer, 0), coalesce((p ->> 'cleanup_minutes')::integer, 0),
    coalesce((p ->> 'buffer_minutes')::integer, 0), nullif(p ->> 'address_id', '')::uuid,
    nullif(p ->> 'address_line1', ''), nullif(p ->> 'address_line2', ''), nullif(p ->> 'postal_code', ''),
    nullif(p ->> 'city', ''), nullif(p ->> 'notes_internal', ''),
    v_total, v_deposit, v_total - v_deposit
  ) returning id into v_id;

  insert into public.appointment_items (
    business_id, appointment_id, service_id, position, service_name, duration_minutes, catalog_price_cents,
    unit_price_cents, price_overridden, extra_fee_cents, vat_rate_bps, price_ht_cents, deposit_type,
    deposit_amount_cents, consumables_cents, products_cents, other_costs_cents
  )
  select v_business, v_id, nullif(i ->> 'service_id', '')::uuid, ord::smallint, i ->> 'service_name',
         (i ->> 'duration_minutes')::integer, (i ->> 'catalog_price_cents')::integer, (i ->> 'unit_price_cents')::integer,
         (i ->> 'unit_price_cents')::integer <> (i ->> 'catalog_price_cents')::integer,
         coalesce((i ->> 'extra_fee_cents')::integer, 0), coalesce((i ->> 'vat_rate_bps')::smallint, 0),
         (i ->> 'price_ht_cents')::integer, coalesce((i ->> 'deposit_type')::public.deposit_type, 'none'),
         coalesce((i ->> 'deposit_amount_cents')::integer, 0), coalesce((i ->> 'consumables_cents')::integer, 0),
         coalesce((i ->> 'products_cents')::integer, 0), coalesce((i ->> 'other_costs_cents')::integer, 0)
  from jsonb_array_elements(p -> 'items') with ordinality as t(i, ord);

  return v_id;
end;
$$;

-- Modification : seuls les champs présents dans p sont changés ; items remplacés si fournis.
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
      deposit_amount_cents, consumables_cents, products_cents, other_costs_cents
    )
    select v_appt.business_id, p_id, nullif(i ->> 'service_id', '')::uuid, ord::smallint, i ->> 'service_name',
           (i ->> 'duration_minutes')::integer, (i ->> 'catalog_price_cents')::integer, (i ->> 'unit_price_cents')::integer,
           (i ->> 'unit_price_cents')::integer <> (i ->> 'catalog_price_cents')::integer,
           coalesce((i ->> 'extra_fee_cents')::integer, 0), coalesce((i ->> 'vat_rate_bps')::smallint, 0),
           (i ->> 'price_ht_cents')::integer, coalesce((i ->> 'deposit_type')::public.deposit_type, 'none'),
           coalesce((i ->> 'deposit_amount_cents')::integer, 0), coalesce((i ->> 'consumables_cents')::integer, 0),
           coalesce((i ->> 'products_cents')::integer, 0), coalesce((i ->> 'other_costs_cents')::integer, 0)
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

revoke all on function public.create_appointment(jsonb) from public, anon;
revoke all on function public.update_appointment(uuid, jsonb) from public, anon;
grant execute on function public.create_appointment(jsonb) to authenticated;
grant execute on function public.update_appointment(uuid, jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- DROITS — aucun rendez-vous supprimé (annulation), historique en lecture seule
-- ════════════════════════════════════════════════════════════════════
revoke all on public.availability_rules, public.availability_exceptions, public.appointments,
  public.appointment_items, public.booking_events, public.appointment_travel, public.booking_holds
  from anon, authenticated;

grant select, insert, update, delete on public.availability_rules, public.availability_exceptions to authenticated;
grant select, insert, update on public.appointments to authenticated;
grant select, insert, delete on public.appointment_items to authenticated;
grant select on public.booking_events to authenticated;
grant select, insert, update on public.appointment_travel to authenticated;

alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_items enable row level security;
alter table public.booking_events enable row level security;
alter table public.appointment_travel enable row level security;
alter table public.booking_holds enable row level security;

-- Horaires et blocages : lecture membres, écriture propriétaire
create policy availability_rules_select on public.availability_rules
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy availability_rules_write on public.availability_rules
  for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));

create policy availability_exceptions_select on public.availability_exceptions
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy availability_exceptions_write on public.availability_exceptions
  for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));

-- Rendez-vous : lecture membres, création et modification propriétaire + staff
create policy appointments_select on public.appointments
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy appointments_insert on public.appointments
  for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));
create policy appointments_update on public.appointments
  for update to authenticated
  using ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));

create policy appointment_items_select on public.appointment_items
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy appointment_items_write on public.appointment_items
  for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));

create policy booking_events_select on public.booking_events
  for select to authenticated using ((select private.is_business_member(business_id)));

create policy appointment_travel_select on public.appointment_travel
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy appointment_travel_write on public.appointment_travel
  for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));
-- booking_holds : aucune politique → accessible uniquement côté serveur (Sprint 4)

-- ════════════════════════════════════════════════════════════════════
-- Remplacement atomique des horaires hebdomadaires (tout ou rien)
-- p_rules : [ { weekday, start_minute, end_minute, place } ]
-- ════════════════════════════════════════════════════════════════════
create or replace function public.replace_availability_rules(p_business_id uuid, p_rules jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_rules) <> 'array' then
    raise exception 'MOKA_INVALID_RULES' using errcode = 'P0001';
  end if;
  delete from public.availability_rules where business_id = p_business_id;
  insert into public.availability_rules (business_id, weekday, start_minute, end_minute, place)
  select p_business_id, (r ->> 'weekday')::smallint, (r ->> 'start_minute')::smallint, (r ->> 'end_minute')::smallint,
         nullif(r ->> 'place', '')::public.service_place
  from jsonb_array_elements(p_rules) r;
end;
$$;
revoke all on function public.replace_availability_rules(uuid, jsonb) from public, anon;
grant execute on function public.replace_availability_rules(uuid, jsonb) to authenticated;
