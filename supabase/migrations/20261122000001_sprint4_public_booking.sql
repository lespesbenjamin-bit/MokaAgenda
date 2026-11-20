-- ════════════════════════════════════════════════════════════════════
-- Moka Réservation — Sprint 4 — Réservation en ligne publique
--
-- Principes de sécurité :
--  • la cliente (rôle anon) n'a AUCUN accès direct aux tables ;
--  • elle passe uniquement par des fonctions public_* (security definer)
--    au périmètre volontairement étroit : elles ne renvoient que des
--    informations publiques ou celles du rendez-vous dont elle détient
--    le lien secret ;
--  • prix, durées et acompte sont relus dans le catalogue par la base :
--    le navigateur n'envoie jamais de prix ;
--  • la disponibilité est revérifiée sous verrou (mêmes déclencheurs et
--    même contrainte d'exclusion que l'agenda du Sprint 3) ;
--  • le lien d'annulation/modification est un jeton aléatoire dont la base
--    ne stocke que l'empreinte SHA-256.
-- Aucune donnée existante n'est supprimée ni écrasée.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Adresse publique de la page (/reserver/<slug>) ─────────────

create or replace function private.slugify(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      left(
        btrim(
          regexp_replace(
            translate(
              replace(replace(lower(coalesce(p, '')), 'œ', 'oe'), 'æ', 'ae'),
              'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ',
              'aaaaaaceeeeiiiinooooouuuuyy'
            ),
            '[^a-z0-9]+', '-', 'g'
          ),
          '-'
        ),
        40
      ),
      ''
    ),
    'pro'
  );
$$;

create or replace function private.unique_business_slug(p_name text, p_exclude uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := btrim(private.slugify(p_name), '-');
  v_candidate text;
  v_n integer := 1;
begin
  if char_length(v_base) < 3 then
    v_base := v_base || '-pro';
  end if;
  v_candidate := v_base;
  while exists (
    select 1 from public.businesses b
    where b.slug = v_candidate and (p_exclude is null or b.id <> p_exclude)
  ) loop
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  end loop;
  return v_candidate;
end;
$$;

alter table public.businesses add column slug text;

-- Comptes existants : identifiant généré à partir du nom commercial
do $$
declare
  r record;
begin
  for r in select id, name from public.businesses where slug is null order by created_at loop
    update public.businesses set slug = private.unique_business_slug(r.name, r.id) where id = r.id;
  end loop;
end $$;

alter table public.businesses
  alter column slug set not null,
  add constraint businesses_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$' and slug !~ '--');
create unique index businesses_slug_uidx on public.businesses (slug);

create or replace function private.business_default_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := private.unique_business_slug(new.name, new.id);
  end if;
  return new;
end;
$$;
create trigger businesses_00_slug before insert on public.businesses
  for each row execute function private.business_default_slug();

grant update (slug) on public.businesses to authenticated;

-- ─── 2. Réglages de la réservation en ligne ─────────────────────────

alter table public.business_settings
  add column booking_enabled boolean not null default false,
  add column public_description text check (char_length(public_description) <= 2000),
  add column cover_path text check (char_length(cover_path) <= 300),
  add column public_phone text check (char_length(public_phone) <= 30),
  add column public_email text check (public_email is null or (char_length(public_email) <= 254 and public_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column public_instagram text check (public_instagram is null or public_instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  add column cancellation_policy text check (char_length(cancellation_policy) <= 2000),
  add column cancellation_notice_hours integer not null default 24 check (cancellation_notice_hours between 0 and 720),
  add column customer_can_cancel boolean not null default true,
  add column customer_can_reschedule boolean not null default true,
  add column booking_window_days integer not null default 60 check (booking_window_days between 1 and 365),
  add column slot_step_minutes smallint not null default 15 check (slot_step_minutes in (5, 10, 15, 20, 30, 60)),
  add column notification_email text check (notification_email is null or (char_length(notification_email) <= 254 and notification_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

grant update (booking_enabled, public_description, cover_path, public_phone, public_email, public_instagram,
  cancellation_policy, cancellation_notice_hours, customer_can_cancel, customer_can_reschedule,
  booking_window_days, slot_step_minutes, notification_email)
  on public.business_settings to authenticated;

-- ─── 3. Rendez-vous : informations de réservation en ligne ─────────

alter table public.appointments
  add column customer_comment text check (char_length(customer_comment) <= 1000),
  add column conditions_snapshot jsonb,
  add column idempotency_key uuid,
  add column public_token_hash text check (public_token_hash ~ '^[0-9a-f]{64}$');
create unique index appointments_idempotency_uidx on public.appointments (business_id, idempotency_key) where idempotency_key is not null;
create unique index appointments_public_token_uidx on public.appointments (public_token_hash) where public_token_hash is not null;
create index appointments_online_recent_idx on public.appointments (business_id, created_at) where source = 'online';

-- ─── 4. Notifications (journal d'envoi des emails) ──────────────────
-- Une ligne par message. Les rappels automatiques (sprint ultérieur)
-- utiliseront scheduled_for ; le statut garde la trace de chaque envoi.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid,
  kind text not null check (kind in (
    'booking_confirmed_customer', 'booking_new_pro',
    'booking_cancelled_customer', 'booking_cancelled_pro',
    'booking_rescheduled_customer', 'booking_rescheduled_pro',
    'reminder_customer'
  )),
  channel text not null default 'email' check (channel in ('email')),
  recipient text not null check (char_length(recipient) <= 254),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'simulated')),
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  provider text check (char_length(provider) <= 40),
  provider_message_id text check (char_length(provider_message_id) <= 200),
  error text check (char_length(error) <= 500),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade
);
create index notifications_business_idx on public.notifications (business_id, created_at desc);
create index notifications_appointment_idx on public.notifications (appointment_id);
create index notifications_pending_idx on public.notifications (scheduled_for) where status = 'pending';

create trigger notifications_lock before update on public.notifications
  for each row execute function private.lock_business_id();

revoke all on public.notifications from anon, authenticated;
grant select, insert on public.notifications to authenticated;
grant update (status, sent_at, provider, provider_message_id, error, attempts) on public.notifications to authenticated;

alter table public.notifications enable row level security;
create policy notifications_select on public.notifications
  for select to authenticated using ((select private.is_business_member(business_id)));
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));
create policy notifications_update on public.notifications
  for update to authenticated
  using ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner', 'staff']::public.member_role[])));

-- ─── 5. Fonctions utilitaires privées ───────────────────────────────

-- Prix TTC d'une prestation pour un lieu (même règle que pricing.ts) :
-- tarif du lieu ou prix de base, promotion si inférieure, + supplément.
create or replace function private.service_total_cents(p_service public.services, p_place_price integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
           when p_service.promo_price_cents is not null
                and p_service.promo_price_cents < coalesce(p_place_price, p_service.base_price_cents)
             then p_service.promo_price_cents
           else coalesce(p_place_price, p_service.base_price_cents)
         end + p_service.extra_fee_cents;
$$;

create or replace function private.normalize_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(?:00)?33([1-9][0-9]{8})$', '0\1'), '');
$$;

-- Entreprise dont la réservation en ligne est ouverte
create or replace function private.bookable_business(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.businesses b
  join public.business_settings s on s.business_id = b.id
  where b.slug = lower(btrim(p_slug)) and s.booking_enabled
  limit 1;
$$;

-- Le créneau chevauche-t-il un blocage temporaire actif (paiement en cours, Sprint 6) ?
create or replace function private.overlaps_active_hold(p_business uuid, p_range tstzrange)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.booking_holds h
    where h.business_id = p_business and h.expires_at > now() and h.occupied && p_range
  );
$$;

-- Crée les notifications d'un événement (cliente + professionnelle).
-- Renvoie [{id, kind, recipient}] au serveur de l'application, qui envoie
-- les emails puis enregistre le résultat (public_record_notification).
create or replace function private.queue_booking_notifications(p_appointment uuid, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a record;
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
  v_kind text;
begin
  select a.id, a.business_id, coalesce(a.conditions_snapshot ->> 'customer_email', c.email) as customer_email,
         coalesce(s.notification_email, b.email) as pro_email
    into v_a
  from public.appointments a
  join public.customers c on c.id = a.customer_id
  join public.businesses b on b.id = a.business_id
  left join public.business_settings s on s.business_id = a.business_id
  where a.id = p_appointment;

  if v_a.customer_email is not null then
    v_kind := 'booking_' || p_event || '_customer';
    insert into public.notifications (business_id, appointment_id, kind, recipient)
    values (v_a.business_id, v_a.id, v_kind, v_a.customer_email)
    returning id into v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'kind', v_kind, 'recipient', v_a.customer_email);
  end if;

  if v_a.pro_email is not null then
    v_kind := case when p_event = 'confirmed' then 'booking_new_pro' else 'booking_' || p_event || '_pro' end;
    insert into public.notifications (business_id, appointment_id, kind, recipient)
    values (v_a.business_id, v_a.id, v_kind, v_a.pro_email)
    returning id into v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'kind', v_kind, 'recipient', v_a.pro_email);
  end if;
  return v_out;
end;
$$;

revoke all on function private.slugify(text) from public;
revoke all on function private.unique_business_slug(text, uuid) from public;
revoke all on function private.service_total_cents(public.services, integer) from public;
revoke all on function private.normalize_phone(text) from public;
revoke all on function private.bookable_business(text) from public;
revoke all on function private.overlaps_active_hold(uuid, tstzrange) from public;
revoke all on function private.queue_booking_notifications(uuid, text) from public;
grant execute on function private.slugify(text) to authenticated;
grant execute on function private.unique_business_slug(text, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. FONCTIONS PUBLIQUES (appelables sans compte)
-- ════════════════════════════════════════════════════════════════════

-- Page publique : informations commerciales et prestations réservables.
-- Ne renvoie ni l'adresse de départ des déplacements, ni aucune donnée cliente.
create or replace function public.public_booking_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := private.bookable_business(p_slug);
  v_result jsonb;
begin
  if v_business is null then
    return null;
  end if;

  select jsonb_build_object(
    'business', jsonb_build_object(
      'name', b.name, 'slug', b.slug, 'activity', b.activity, 'activity_mode', b.activity_mode,
      'logo_path', b.logo_path, 'cover_path', s.cover_path, 'description', s.public_description,
      'phone', s.public_phone, 'email', s.public_email, 'instagram', s.public_instagram
    ),
    'settings', jsonb_build_object(
      'timezone', s.timezone, 'booking_window_days', s.booking_window_days,
      'slot_step_minutes', s.slot_step_minutes, 'cancellation_notice_hours', s.cancellation_notice_hours,
      'customer_can_cancel', s.customer_can_cancel, 'customer_can_reschedule', s.customer_can_reschedule,
      'cancellation_policy', s.cancellation_policy, 'booking_terms', s.booking_terms
    ),
    'salon', (
      select jsonb_build_object('line1', l.address_line1, 'line2', l.address_line2, 'postal_code', l.postal_code, 'city', l.city)
      from public.locations l where l.business_id = b.id and l.kind = 'salon'
    ),
    'has_hours', exists (select 1 from public.availability_rules r where r.business_id = b.id),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.position, c.name)
      from public.service_categories c
      where c.business_id = b.id and c.archived_at is null and c.is_visible
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sv.id, 'category_id', sv.category_id, 'name', sv.name, 'description', sv.description,
        'photo_path', sv.photo_path, 'duration_minutes', sv.duration_minutes,
        'prep_minutes', sv.prep_minutes, 'cleanup_minutes', sv.cleanup_minutes, 'buffer_minutes', sv.buffer_minutes,
        'min_notice_minutes', sv.min_notice_minutes,
        'deposit_type', sv.deposit_type, 'deposit_value', sv.deposit_value,
        'extra_fee_cents', sv.extra_fee_cents, 'extra_fee_label', sv.extra_fee_label,
        'places', (
          select coalesce(jsonb_agg(jsonb_build_object('place', sl.place, 'price_cents', private.service_total_cents(sv, sl.price_cents)) order by sl.place desc), '[]'::jsonb)
          from public.service_locations sl where sl.service_id = sv.id
        )
      ) order by sv.name)
      from public.services sv
      left join public.service_categories cat on cat.id = sv.category_id
      where sv.business_id = b.id and sv.is_active and sv.online_bookable and sv.archived_at is null
        and (sv.category_id is null or (cat.archived_at is null and cat.is_visible))
        and exists (select 1 from public.service_locations sl where sl.service_id = sv.id)
    ), '[]'::jsonb)
  ) into v_result
  from public.businesses b
  join public.business_settings s on s.business_id = b.id
  where b.id = v_business;

  return v_result;
end;
$$;

-- Données de disponibilité : plages horaires, périodes bloquées (sans
-- motif) et temps occupés (sans aucune information sur les rendez-vous).
-- p_exclude_token_hash : ignore le rendez-vous que la cliente déplace.
create or replace function public.public_availability(p_slug text, p_from timestamptz, p_to timestamptz, p_exclude_token_hash text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business uuid := private.bookable_business(p_slug);
begin
  if v_business is null then
    return null;
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '45 days' then
    raise exception 'MOKA_INVALID_RANGE' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', r.weekday, 'start_minute', r.start_minute, 'end_minute', r.end_minute, 'place', r.place))
      from public.availability_rules r where r.business_id = v_business
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object('start', e.starts_at, 'end', e.ends_at, 'place', e.place))
      from public.availability_exceptions e
      where e.business_id = v_business and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
    ), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('start', lower(x.occupied), 'end', upper(x.occupied)))
      from (
        select a.occupied from public.appointments a
        where a.business_id = v_business and a.status in ('pending', 'confirmed')
          and a.occupied && tstzrange(p_from, p_to, '[)')
          and (p_exclude_token_hash is null or a.public_token_hash is distinct from p_exclude_token_hash)
        union all
        select h.occupied from public.booking_holds h
        where h.business_id = v_business and h.expires_at > now() and h.occupied && tstzrange(p_from, p_to, '[)')
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- Réservation en ligne sans compte.
-- Paramètres (jsonb) : slug, service_id, place, starts_at, first_name, last_name,
-- email, phone, address_line1, address_line2, postal_code, city, comment,
-- accept_terms, idempotency_key, token_hash.
create or replace function public.public_create_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid := private.bookable_business(p ->> 'slug');
  v_settings public.business_settings%rowtype;
  v_service public.services%rowtype;
  v_place public.service_place;
  v_place_price integer;
  v_start timestamptz;
  v_range tstzrange;
  v_total integer;
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
begin
  if v_business is null then
    raise exception 'MOKA_BOOKING_UNAVAILABLE' using errcode = 'P0001';
  end if;
  select * into v_settings from public.business_settings where business_id = v_business;

  -- Validation stricte des entrées
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

  -- Prestation : active, réservable en ligne, proposée à ce lieu, sans acompte
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

  -- Délai minimum, horizon de réservation, grille de 5 minutes
  if v_start < now() + make_interval(mins => v_service.min_notice_minutes) then
    raise exception 'MOKA_TOO_LATE' using errcode = 'P0001';
  end if;
  if v_start > now() + make_interval(days => v_settings.booking_window_days) then
    raise exception 'MOKA_TOO_FAR' using errcode = 'P0001';
  end if;
  if extract(second from v_start) <> 0 or extract(minute from v_start)::integer % 5 <> 0 then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Sérialise les réservations de l'entreprise (même verrou que l'agenda)
  perform private.lock_schedule(v_business);

  -- Double soumission : renvoie la réservation déjà enregistrée
  select a.id into v_appointment from public.appointments a
  where a.business_id = v_business and a.idempotency_key = v_key;
  if found then
    return jsonb_build_object('appointment_id', v_appointment, 'duplicate', true, 'notifications', '[]'::jsonb);
  end if;

  -- Anti-abus (indépendant de l'adresse IP) : plafonds par entreprise et par contact
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

  -- Fiche cliente : réutilise la fiche existante (email, puis téléphone) sans
  -- écraser ce que la professionnelle a saisi ; complète seulement les vides.
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
      insert into public.customer_addresses (business_id, customer_id, kind, line1, line2, postal_code, city, is_primary)
      values (v_business, v_customer, 'home', v_line1, v_line2, v_postal, v_city,
              not exists (select 1 from public.customer_addresses x where x.customer_id = v_customer and x.is_primary))
      returning id into v_address;
    end if;
  end if;

  -- Rendez-vous : confirmé d'office (aucun acompte), contrôlé par les
  -- mêmes déclencheurs et la même contrainte d'exclusion que l'agenda.
  begin
    insert into public.appointments (
      business_id, customer_id, place, status, source, starts_at, duration_minutes, prep_minutes,
      cleanup_minutes, buffer_minutes, address_id, address_line1, address_line2, postal_code, city,
      price_total_cents, deposit_amount_cents, balance_due_cents, customer_comment, conditions_snapshot,
      idempotency_key, public_token_hash
    ) values (
      v_business, v_customer, v_place, 'confirmed', 'online', v_start, v_service.duration_minutes,
      v_service.prep_minutes, v_service.cleanup_minutes, v_service.buffer_minutes, v_address,
      v_line1, v_line2, v_postal, v_city, v_total, 0, v_total, v_comment,
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
      v_key, v_hash
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

  return jsonb_build_object(
    'appointment_id', v_appointment,
    'duplicate', false,
    'notifications', private.queue_booking_notifications(v_appointment, 'confirmed')
  );
end;
$$;

-- Détail d'un rendez-vous pour la cliente qui détient le lien secret.
create or replace function public.public_get_booking(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select jsonb_build_object(
    'id', a.id,
    'reference', upper(left(a.id::text, 8)),
    'status', a.status,
    'source', a.source,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'duration_minutes', a.duration_minutes,
    'prep_minutes', a.prep_minutes,
    'cleanup_minutes', a.cleanup_minutes,
    'buffer_minutes', a.buffer_minutes,
    'place', a.place,
    'address', case when a.place = 'home' then jsonb_build_object('line1', a.address_line1, 'line2', a.address_line2, 'postal_code', a.postal_code, 'city', a.city) end,
    'price_total_cents', a.price_total_cents,
    'deposit_amount_cents', a.deposit_amount_cents,
    'comment', a.customer_comment,
    'cancelled_at', a.cancelled_at,
    'customer', jsonb_build_object('first_name', c.first_name, 'last_name', c.last_name, 'email', coalesce(a.conditions_snapshot ->> 'customer_email', c.email), 'phone', coalesce(a.conditions_snapshot ->> 'customer_phone', c.phone)),
    'items', (select jsonb_agg(jsonb_build_object('service_id', i.service_id, 'name', i.service_name, 'duration_minutes', i.duration_minutes, 'price_cents', i.unit_price_cents + i.extra_fee_cents) order by i.position)
              from public.appointment_items i where i.appointment_id = a.id),
    'min_notice_minutes', coalesce((select sv.min_notice_minutes from public.appointment_items i join public.services sv on sv.id = i.service_id where i.appointment_id = a.id order by i.position limit 1), 0),
    'business', jsonb_build_object('name', b.name, 'slug', b.slug, 'phone', s.public_phone, 'email', s.public_email,
                                   'booking_enabled', s.booking_enabled, 'timezone', s.timezone,
                                   'booking_window_days', s.booking_window_days, 'slot_step_minutes', s.slot_step_minutes),
    'salon', case when a.place = 'salon' then (select jsonb_build_object('line1', l.address_line1, 'line2', l.address_line2, 'postal_code', l.postal_code, 'city', l.city)
                                               from public.locations l where l.business_id = a.business_id and l.kind = 'salon') end,
    'policy', jsonb_build_object(
      'cancellation_notice_hours', coalesce((a.conditions_snapshot ->> 'cancellation_notice_hours')::integer, s.cancellation_notice_hours),
      'customer_can_cancel', coalesce((a.conditions_snapshot ->> 'customer_can_cancel')::boolean, s.customer_can_cancel),
      'customer_can_reschedule', coalesce((a.conditions_snapshot ->> 'customer_can_reschedule')::boolean, s.customer_can_reschedule),
      'cancellation_policy', coalesce(a.conditions_snapshot ->> 'cancellation_policy', s.cancellation_policy)
    ),
    'reschedule_count', (select count(*) from public.booking_events e where e.appointment_id = a.id and e.event_type = 'rescheduled' and e.actor_id is null)
  ) into v_result
  from public.appointments a
  join public.customers c on c.id = a.customer_id
  join public.businesses b on b.id = a.business_id
  join public.business_settings s on s.business_id = a.business_id
  where a.public_token_hash = p_token_hash;

  return v_result;
end;
$$;

-- Contrôle commun : la cliente peut-elle encore agir sur ce rendez-vous ?
create or replace function private.customer_may_change(a public.appointments, p_action text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_notice integer;
  v_allowed boolean;
begin
  if a.status not in ('pending', 'confirmed') then
    raise exception 'MOKA_APPOINTMENT_CLOSED' using errcode = 'P0001';
  end if;
  select coalesce((a.conditions_snapshot ->> 'cancellation_notice_hours')::integer, s.cancellation_notice_hours),
         case when p_action = 'cancel'
              then coalesce((a.conditions_snapshot ->> 'customer_can_cancel')::boolean, s.customer_can_cancel)
              else coalesce((a.conditions_snapshot ->> 'customer_can_reschedule')::boolean, s.customer_can_reschedule) end
    into v_notice, v_allowed
  from public.business_settings s where s.business_id = a.business_id;
  if not coalesce(v_allowed, false) then
    raise exception 'MOKA_CHANGE_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if now() > a.starts_at - make_interval(hours => coalesce(v_notice, 0)) then
    raise exception 'MOKA_CHANGE_TOO_LATE' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.customer_may_change(public.appointments, text) from public;

create or replace function public.public_cancel_booking(p_token_hash text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_a from public.appointments where public_token_hash = p_token_hash for update;
  if not found then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.customer_may_change(v_a, 'cancel');

  update public.appointments set
    status = 'cancelled',
    cancel_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Annulé en ligne par la cliente'), 500)
  where id = v_a.id;

  return jsonb_build_object('notifications', private.queue_booking_notifications(v_a.id, 'cancelled'));
end;
$$;

create or replace function public.public_reschedule_booking(p_token_hash text, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.appointments%rowtype;
  v_window integer;
  v_notice_min integer;
  v_range tstzrange;
  v_count integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_a from public.appointments where public_token_hash = p_token_hash;
  if not found then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.lock_schedule(v_a.business_id);
  select * into v_a from public.appointments where id = v_a.id for update;
  perform private.customer_may_change(v_a, 'reschedule');

  if p_starts_at is null or p_starts_at = v_a.starts_at
     or extract(second from p_starts_at) <> 0 or extract(minute from p_starts_at)::integer % 5 <> 0 then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.booking_events e
  where e.appointment_id = v_a.id and e.event_type = 'rescheduled' and e.actor_id is null;
  if v_count >= 3 then
    raise exception 'MOKA_RATE_LIMITED' using errcode = 'P0001';
  end if;

  select s.booking_window_days into v_window from public.business_settings s where s.business_id = v_a.business_id;
  select coalesce(max(sv.min_notice_minutes), 0) into v_notice_min
  from public.appointment_items i join public.services sv on sv.id = i.service_id where i.appointment_id = v_a.id;
  if p_starts_at < now() + make_interval(mins => v_notice_min) then
    raise exception 'MOKA_TOO_LATE' using errcode = 'P0001';
  end if;
  if p_starts_at > now() + make_interval(days => coalesce(v_window, 60)) then
    raise exception 'MOKA_TOO_FAR' using errcode = 'P0001';
  end if;

  v_range := tstzrange(
    p_starts_at - make_interval(mins => v_a.prep_minutes),
    p_starts_at + make_interval(mins => v_a.duration_minutes + v_a.cleanup_minutes + v_a.buffer_minutes),
    '[)'
  );
  if private.overlaps_active_hold(v_a.business_id, v_range) then
    raise exception 'MOKA_SLOT_TAKEN' using errcode = 'P0001';
  end if;

  begin
    update public.appointments set starts_at = p_starts_at where id = v_a.id;
  exception when exclusion_violation then
    raise exception 'MOKA_SLOT_TAKEN' using errcode = 'P0001';
  end;

  return jsonb_build_object('notifications', private.queue_booking_notifications(v_a.id, 'rescheduled'));
end;
$$;

-- Résultat d'envoi d'une notification liée au rendez-vous du jeton
create or replace function public.public_record_notification(
  p_token_hash text, p_notification_id uuid, p_status text, p_provider text default null,
  p_message_id text default null, p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped', 'simulated') then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;
  update public.notifications n set
    status = p_status,
    sent_at = case when p_status in ('sent', 'simulated') then now() end,
    provider = left(p_provider, 40),
    provider_message_id = left(p_message_id, 200),
    error = left(p_error, 500),
    attempts = n.attempts + 1
  from public.appointments a
  where n.id = p_notification_id and n.appointment_id = a.id and n.status = 'pending'
    and p_token_hash ~ '^[0-9a-f]{64}$' and a.public_token_hash = p_token_hash;
end;
$$;

-- ─── Droits d'exécution ─────────────────────────────────────────────
revoke all on function public.public_booking_page(text) from public;
revoke all on function public.public_availability(text, timestamptz, timestamptz, text) from public;
revoke all on function public.public_create_booking(jsonb) from public;
revoke all on function public.public_get_booking(text) from public;
revoke all on function public.public_cancel_booking(text, text) from public;
revoke all on function public.public_reschedule_booking(text, timestamptz) from public;
revoke all on function public.public_record_notification(text, uuid, text, text, text, text) from public;

grant execute on function public.public_booking_page(text) to anon, authenticated;
grant execute on function public.public_availability(text, timestamptz, timestamptz, text) to anon, authenticated;
grant execute on function public.public_create_booking(jsonb) to anon, authenticated;
grant execute on function public.public_get_booking(text) to anon, authenticated;
grant execute on function public.public_cancel_booking(text, text) to anon, authenticated;
grant execute on function public.public_reschedule_booking(text, timestamptz) to anon, authenticated;
grant execute on function public.public_record_notification(text, uuid, text, text, text, text) to anon, authenticated;
