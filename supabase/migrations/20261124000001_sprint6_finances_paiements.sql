-- ════════════════════════════════════════════════════════════════════
-- Moka Réservation — Sprint 6 — Finances, encaissements, arrhes Stripe
--
-- Principes :
--  * montants en centimes (integer), devise ISO en minuscules ;
--  * les finances ne sont visibles que par la propriétaire (business_owner) ;
--  * le registre des paiements est en lecture seule pour l'application :
--    les paiements Stripe ne sont écrits que par le serveur, après
--    vérification de la signature Stripe, via des opérations signées
--    (HMAC, même clé serveur que le Sprint 5) ;
--  * aucune suppression ni modification d'un paiement passé : les
--    corrections passent par des écritures d'ajustement traçables ;
--  * aucun numéro de carte n'est stocké (Stripe Checkout).
-- ════════════════════════════════════════════════════════════════════

-- ─── Paramètres financiers ──────────────────────────────────────────
create table public.financial_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  activity_regime text not null default 'not_set'
    check (activity_regime in ('not_set', 'micro_bic_services', 'micro_bnc', 'micro_bic_sales', 'ei_real', 'company', 'other')),
  vat_status text not null default 'not_set' check (vat_status in ('not_set', 'franchise', 'liable')),
  contribution_rate_bps integer not null default 0 check (contribution_rate_bps between 0 and 10000),
  contribution_base text not null default 'revenue' check (contribution_base in ('revenue', 'profit')),
  tax_provision_rate_bps integer not null default 0 check (tax_provision_rate_bps between 0 and 10000),
  tax_provision_base text not null default 'revenue' check (tax_provision_base in ('revenue', 'profit')),
  deposit_kind text not null default 'arrhes' check (deposit_kind in ('arrhes', 'acompte')),
  deposit_terms text check (char_length(deposit_terms) <= 2000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.bump_version()
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
create trigger financial_settings_version before update on public.financial_settings
  for each row execute function private.bump_version();

create table public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  category text not null check (category in ('rent', 'insurance', 'software', 'phone', 'subscription', 'bank', 'other')),
  amount_cents integer not null check (amount_cents between 1 and 10000000),
  frequency text not null check (frequency in ('monthly', 'quarterly', 'yearly')),
  starts_on date not null default current_date,
  ends_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_expenses_dates check (ends_on is null or ends_on >= starts_on)
);
create index fixed_expenses_business_idx on public.fixed_expenses (business_id);
create trigger fixed_expenses_lock before update on public.fixed_expenses
  for each row execute function private.lock_business_id();

create table public.financial_goals (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  monthly_revenue_cents integer check (monthly_revenue_cents between 0 and 100000000),
  monthly_disposable_income_cents integer check (monthly_disposable_income_cents between 0 and 100000000),
  monthly_appointments integer check (monthly_appointments between 0 and 10000),
  hourly_margin_cents integer check (hourly_margin_cents between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger financial_goals_lock before update on public.financial_goals
  for each row execute function private.lock_business_id();

-- ─── Compte Stripe connecté (Stripe Connect, paiement direct) ───────
create table public.payment_accounts (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  livemode boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  requirements_due text[] not null default '{}',
  disabled_reason text check (char_length(disabled_reason) <= 200),
  country text check (char_length(country) <= 2),
  default_currency text check (default_currency ~ '^[a-z]{3}$'),
  last_event_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Réservation temporaire pendant le paiement (table du Sprint 3) ─
alter table public.booking_holds
  add column status text not null default 'open'
    check (status in ('open', 'converted', 'expired', 'cancelled', 'refund_required')),
  add column payload jsonb,
  add column enc_token text check (char_length(enc_token) <= 400),
  add column total_cents integer check (total_cents >= 0),
  add column deposit_cents integer check (deposit_cents > 0),
  add column travel_fee_cents integer not null default 0 check (travel_fee_cents >= 0),
  add column currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  add column customer_email text check (char_length(customer_email) <= 254),
  add column idempotency_key uuid,
  add column latitude numeric(9, 6),
  add column longitude numeric(9, 6),
  add column geo_postcode text check (char_length(geo_postcode) <= 12),
  add column deposit_kind text check (deposit_kind in ('arrhes', 'acompte')),
  add column stripe_account_id text,
  add column checkout_session_id text unique check (char_length(checkout_session_id) <= 255),
  add column appointment_id uuid,
  add column error_code text check (char_length(error_code) <= 80),
  add column updated_at timestamptz not null default now();
create unique index booking_holds_idempotency_uidx on public.booking_holds (business_id, idempotency_key)
  where idempotency_key is not null;

-- ─── Registre des paiements ─────────────────────────────────────────
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  appointment_id uuid,
  customer_id uuid,
  kind text not null check (kind in ('deposit', 'balance', 'other')),
  method text not null check (method in ('card_online', 'card_terminal', 'cash', 'transfer', 'check', 'other')),
  status text not null check (status in ('pending', 'succeeded', 'cancelled', 'failed')),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  fee_cents integer check (fee_cents between 0 and 100000000),
  livemode boolean,
  stripe_account_id text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  stripe_balance_transaction_id text,
  available_on timestamptz,
  received_at timestamptz not null default now(),
  validated_at timestamptz,
  validated_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 300),
  note text check (char_length(note) <= 500),
  idempotency_key uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade,
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete set null (customer_id),
  constraint payments_online_ids check (method <> 'card_online' or stripe_payment_intent_id is not null),
  constraint payments_validated check (status <> 'succeeded' or validated_at is not null)
);
create index payments_business_received_idx on public.payments (business_id, received_at);
create index payments_appointment_idx on public.payments (appointment_id);
create unique index payments_idempotency_uidx on public.payments (business_id, idempotency_key) where idempotency_key is not null;

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  payment_id uuid not null,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  status text not null check (status in ('requested', 'pending', 'succeeded', 'failed', 'canceled')),
  reason text not null check (reason in ('customer_request', 'cancellation', 'slot_unavailable', 'duplicate', 'amount_mismatch', 'other')),
  note text check (char_length(note) <= 500),
  stripe_refund_id text unique,
  failure_reason text check (char_length(failure_reason) <= 200),
  requested_by uuid references auth.users (id) on delete set null,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (payment_id, business_id) references public.payments (id, business_id) on delete cascade
);
create index refunds_business_idx on public.refunds (business_id, created_at);
create index refunds_payment_idx on public.refunds (payment_id);

create table public.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  payment_id uuid not null,
  stripe_dispute_id text not null unique,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null check (char_length(status) <= 40),
  reason text check (char_length(reason) <= 60),
  evidence_due_by timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (payment_id, business_id) references public.payments (id, business_id) on delete cascade
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  stripe_payout_id text not null unique,
  amount_cents integer not null,
  currency text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  status text not null check (status in ('pending', 'in_transit', 'paid', 'failed', 'canceled')),
  arrival_date timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payouts_business_idx on public.payouts (business_id, arrival_date);

-- Journal des événements Stripe (idempotence, reprise). Aucun contenu
-- personnel : identifiant, type, statut de traitement et erreur courte.
create table public.payment_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]{6,80}$'),
  business_id uuid references public.businesses (id) on delete set null,
  type text not null check (char_length(type) <= 80),
  stripe_account_id text,
  livemode boolean not null,
  stripe_created_at timestamptz not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed', 'ignored')),
  outcome text check (char_length(outcome) <= 80),
  attempts integer not null default 1,
  last_error text check (char_length(last_error) <= 200),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index payment_events_business_idx on public.payment_events (business_id, received_at);

-- Écritures d'ajustement : seule façon de corriger (montant signé).
create table public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('revenue', 'collection', 'expense', 'fee')),
  amount_cents integer not null check (amount_cents <> 0 and amount_cents between -100000000 and 100000000),
  occurred_on date not null,
  appointment_id uuid,
  payment_id uuid,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade,
  foreign key (payment_id, business_id) references public.payments (id, business_id) on delete cascade
);
create index financial_adjustments_business_idx on public.financial_adjustments (business_id, occurred_on);

-- ─── Immuabilité du registre ────────────────────────────────────────
create or replace function private.payments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.businesses where id = old.business_id) then
      raise exception 'MOKA_LEDGER_IMMUTABLE' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.business_id <> old.business_id or new.amount_cents <> old.amount_cents or new.currency <> old.currency
     or new.kind <> old.kind or new.method <> old.method or new.appointment_id is distinct from old.appointment_id
     or new.received_at <> old.received_at or new.created_at <> old.created_at
     or (old.stripe_payment_intent_id is not null and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id)
     or (old.fee_cents is not null and new.fee_cents is distinct from old.fee_cents) then
    raise exception 'MOKA_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  if new.status <> old.status and not (old.status = 'pending' and new.status in ('succeeded', 'cancelled')) then
    raise exception 'MOKA_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger payments_guard before update or delete on public.payments
  for each row execute function private.payments_guard();

create or replace function private.refunds_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.businesses where id = old.business_id) then
      raise exception 'MOKA_LEDGER_IMMUTABLE' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.amount_cents <> old.amount_cents or new.payment_id <> old.payment_id or new.business_id <> old.business_id
     or old.status in ('succeeded', 'failed', 'canceled') and new.status <> old.status then
    raise exception 'MOKA_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger refunds_guard before update or delete on public.refunds
  for each row execute function private.refunds_guard();

create or replace function private.adjustments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.businesses where id = old.business_id) then
    return old;
  end if;
  raise exception 'MOKA_LEDGER_IMMUTABLE' using errcode = '42501';
end;
$$;
create trigger financial_adjustments_guard before update or delete on public.financial_adjustments
  for each row execute function private.adjustments_guard();

-- Statut de paiement du rendez-vous, recalculé depuis le registre.
create or replace function private.refresh_payment_status(p_appointment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid integer;
  v_refunded integer;
  v_total integer;
  v_status public.payment_status;
begin
  if p_appointment is null then
    return;
  end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.payments
  where appointment_id = p_appointment and status = 'succeeded';
  select coalesce(sum(r.amount_cents), 0) into v_refunded from public.refunds r
  join public.payments p on p.id = r.payment_id
  where p.appointment_id = p_appointment and r.status = 'succeeded';
  select price_total_cents into v_total from public.appointments where id = p_appointment;
  v_status := case
    when v_paid = 0 then 'unpaid'
    when v_paid - v_refunded <= 0 then 'refunded'
    when v_paid - v_refunded >= v_total then 'paid'
    else 'deposit_paid' end;
  update public.appointments set payment_status = v_status
  where id = p_appointment and payment_status is distinct from v_status;
end;
$$;

create or replace function private.payments_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'payments' then
    perform private.refresh_payment_status(new.appointment_id);
  else
    perform private.refresh_payment_status((select appointment_id from public.payments where id = new.payment_id));
  end if;
  return null;
end;
$$;
create trigger payments_status after insert or update on public.payments
  for each row execute function private.payments_after_change();
create trigger refunds_status after insert or update on public.refunds
  for each row execute function private.payments_after_change();

revoke all on function private.bump_version() from public;
revoke all on function private.payments_guard() from public;
revoke all on function private.refunds_guard() from public;
revoke all on function private.adjustments_guard() from public;
revoke all on function private.refresh_payment_status(uuid) from public;
revoke all on function private.payments_after_change() from public;

-- ─── Droits et RLS : propriétaire uniquement ────────────────────────
revoke all on public.financial_settings, public.fixed_expenses, public.financial_goals, public.payment_accounts,
  public.payments, public.refunds, public.payment_disputes, public.payouts, public.payment_events,
  public.financial_adjustments from anon, authenticated;

grant select, insert on public.financial_settings to authenticated;
grant update (activity_regime, vat_status, contribution_rate_bps, contribution_base, tax_provision_rate_bps,
  tax_provision_base, deposit_kind, deposit_terms) on public.financial_settings to authenticated;
grant select, insert, delete on public.fixed_expenses to authenticated;
grant update (label, category, amount_cents, frequency, starts_on, ends_on, archived_at) on public.fixed_expenses to authenticated;
grant select, insert on public.financial_goals to authenticated;
grant update (monthly_revenue_cents, monthly_disposable_income_cents, monthly_appointments, hourly_margin_cents)
  on public.financial_goals to authenticated;
grant select on public.payment_accounts, public.payments, public.refunds, public.payment_disputes, public.payouts,
  public.payment_events to authenticated;
grant select, insert on public.financial_adjustments to authenticated;

alter table public.financial_settings enable row level security;
alter table public.fixed_expenses enable row level security;
alter table public.financial_goals enable row level security;
alter table public.payment_accounts enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.payment_disputes enable row level security;
alter table public.payouts enable row level security;
alter table public.payment_events enable row level security;
alter table public.financial_adjustments enable row level security;

create policy financial_settings_owner on public.financial_settings for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy fixed_expenses_owner on public.fixed_expenses for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy financial_goals_owner on public.financial_goals for all to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])))
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy payment_accounts_owner on public.payment_accounts for select to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy payments_owner on public.payments for select to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy refunds_owner on public.refunds for select to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy payment_disputes_owner on public.payment_disputes for select to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy payouts_owner on public.payouts for select to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy payment_events_owner on public.payment_events for select to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy financial_adjustments_select on public.financial_adjustments for select to authenticated
  using ((select private.has_business_role(business_id, array['business_owner']::public.member_role[])));
create policy financial_adjustments_insert on public.financial_adjustments for insert to authenticated
  with check ((select private.has_business_role(business_id, array['business_owner']::public.member_role[]))
              and created_by = (select auth.uid()));

-- Paramètres créés pour les entreprises existantes et futures.
insert into public.financial_settings (business_id) select id from public.businesses on conflict do nothing;
insert into public.financial_goals (business_id) select id from public.businesses on conflict do nothing;
create or replace function private.business_financial_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.financial_settings (business_id) values (new.id) on conflict do nothing;
  insert into public.financial_goals (business_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.business_financial_defaults() from public;
create trigger businesses_financial_defaults after insert on public.businesses
  for each row execute function private.business_financial_defaults();

-- ─── Règlements saisis par la professionnelle ───────────────────────
-- Un règlement n'est « encaissé » qu'avec une validation explicite
-- (p.confirmed = true, ou validate_manual_payment ensuite).
create or replace function private.appointment_net_paid(p_appointment uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(amount_cents) from public.payments where appointment_id = p_appointment and status in ('succeeded', 'pending')), 0)
       - coalesce((select sum(r.amount_cents) from public.refunds r join public.payments p on p.id = r.payment_id
                   where p.appointment_id = p_appointment and r.status in ('requested', 'pending', 'succeeded')), 0);
$$;
revoke all on function private.appointment_net_paid(uuid) from public;

create or replace function public.record_manual_payment(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments%rowtype;
  v_amount integer;
  v_method text := p ->> 'method';
  v_kind text := coalesce(p ->> 'kind', 'balance');
  v_confirmed boolean := coalesce((p ->> 'confirmed')::boolean, false);
  v_received timestamptz;
  v_key uuid;
  v_id uuid;
begin
  begin
    v_amount := (p ->> 'amount_cents')::integer;
    v_received := coalesce((p ->> 'received_at')::timestamptz, now());
    v_key := nullif(p ->> 'idempotency_key', '')::uuid;
  exception when others then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end;
  select * into v_appt from public.appointments where id = nullif(p ->> 'appointment_id', '')::uuid for update;
  if not found or not private.has_business_role(v_appt.business_id, array['business_owner']::public.member_role[]) then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_key is not null then
    select id into v_id from public.payments where business_id = v_appt.business_id and idempotency_key = v_key;
    if found then
      return v_id;
    end if;
  end if;
  if v_method is null or v_method not in ('card_terminal', 'cash', 'transfer', 'check', 'other') or v_kind not in ('deposit', 'balance', 'other') then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;
  if v_appt.status = 'cancelled' and v_kind <> 'other' then
    raise exception 'MOKA_APPOINTMENT_CANCELLED' using errcode = 'P0001';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > v_appt.price_total_cents - private.appointment_net_paid(v_appt.id) then
    raise exception 'MOKA_AMOUNT_TOO_HIGH' using errcode = 'P0001';
  end if;
  if v_received > now() + interval '1 day' then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;
  insert into public.payments (business_id, appointment_id, customer_id, kind, method, status, amount_cents, received_at,
                               validated_at, validated_by, note, idempotency_key, created_by)
  values (v_appt.business_id, v_appt.id, v_appt.customer_id, v_kind, v_method,
          case when v_confirmed then 'succeeded' else 'pending' end, v_amount, v_received,
          case when v_confirmed then now() end, case when v_confirmed then auth.uid() end,
          nullif(btrim(coalesce(p ->> 'note', '')), ''), v_key, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.validate_manual_payment(p_id uuid, p_validate boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments%rowtype;
begin
  select * into v from public.payments where id = p_id for update;
  if not found or not private.has_business_role(v.business_id, array['business_owner']::public.member_role[]) then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status <> 'pending' or v.method = 'card_online' then
    raise exception 'MOKA_PAYMENT_NOT_PENDING' using errcode = 'P0001';
  end if;
  if p_validate then
    update public.payments set status = 'succeeded', validated_at = now(), validated_by = auth.uid() where id = p_id;
  else
    update public.payments set status = 'cancelled', cancelled_at = now(), cancel_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300)
    where id = p_id;
  end if;
end;
$$;

-- Remboursement : manuel (enregistré comme effectué) ou Stripe
-- (« requested », exécuté ensuite par le serveur avec la clé d'idempotence = id).
create or replace function public.request_refund(p_payment uuid, p_amount integer, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payments%rowtype;
  v_refundable integer;
  v_id uuid;
begin
  select * into v from public.payments where id = p_payment for update;
  if not found or not private.has_business_role(v.business_id, array['business_owner']::public.member_role[]) then
    raise exception 'MOKA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v.status <> 'succeeded' then
    raise exception 'MOKA_PAYMENT_NOT_REFUNDABLE' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('customer_request', 'cancellation', 'duplicate', 'other') then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;
  select v.amount_cents - coalesce(sum(amount_cents), 0) into v_refundable from public.refunds
  where payment_id = v.id and status in ('requested', 'pending', 'succeeded');
  if p_amount is null or p_amount <= 0 or p_amount > v_refundable then
    raise exception 'MOKA_REFUND_TOO_HIGH' using errcode = 'P0001';
  end if;
  insert into public.refunds (business_id, payment_id, amount_cents, status, reason, note, requested_by, processed_at)
  values (v.business_id, v.id, p_amount, case when v.method = 'card_online' then 'requested' else 'succeeded' end,
          p_reason, left(nullif(btrim(coalesce(p_note, '')), ''), 500), auth.uid(),
          case when v.method = 'card_online' then null else now() end)
  returning id into v_id;
  return jsonb_build_object('refund_id', v_id, 'online', v.method = 'card_online',
                            'payment_intent_id', v.stripe_payment_intent_id, 'stripe_account_id', v.stripe_account_id,
                            'amount_cents', p_amount);
end;
$$;

revoke all on function public.record_manual_payment(jsonb) from public, anon;
revoke all on function public.validate_manual_payment(uuid, boolean, text) from public, anon;
revoke all on function public.request_refund(uuid, integer, text, text) from public, anon;
grant execute on function public.record_manual_payment(jsonb) to authenticated;
grant execute on function public.validate_manual_payment(uuid, boolean, text) to authenticated;
grant execute on function public.request_refund(uuid, integer, text, text) to authenticated;
create or replace function private.online_booking(p jsonb, p_hold uuid)
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
  v_confirm boolean := p_hold is not null;
  v_hold public.booking_holds%rowtype;
  v_fin public.financial_settings%rowtype;
  v_acct public.payment_accounts%rowtype;
  v_deposit integer := 0;
  v_hold_id uuid;
begin
  if v_business is null then
    raise exception 'MOKA_BOOKING_UNAVAILABLE' using errcode = 'P0001';
  end if;
  select * into v_settings from public.business_settings where business_id = v_business;
  select * into v_travel from public.travel_settings where business_id = v_business;
  v_travel_on := coalesce(v_travel.enabled, false);
  select * into v_fin from public.financial_settings where business_id = v_business;
  if v_confirm then
    select * into v_hold from public.booking_holds where id = p_hold and business_id = v_business;
    if not found then
      raise exception 'MOKA_HOLD_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

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
  select sl.price_cents into v_place_price from public.service_locations sl
  where sl.service_id = v_service.id and sl.place = v_place;
  if not found then
    raise exception 'MOKA_PLACE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_total := private.service_total_cents(v_service, v_place_price);
  -- Arrhes / acompte : calculés ici sur le prix de la prestation (hors frais de déplacement).
  v_deposit := case v_service.deposit_type
    when 'fixed' then least(v_service.deposit_value, v_total)
    when 'percentage' then round(v_total * v_service.deposit_value / 100.0)::integer
    else 0 end;

  if v_start <= now() or (not v_confirm and v_start < now() + make_interval(mins => v_service.min_notice_minutes)) then
    raise exception 'MOKA_TOO_LATE' using errcode = 'P0001';
  end if;
  if not v_confirm and v_start > now() + make_interval(days => v_settings.booking_window_days) then
    raise exception 'MOKA_TOO_FAR' using errcode = 'P0001';
  end if;
  if extract(second from v_start) <> 0 or extract(minute from v_start)::integer % 5 <> 0 then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Déplacement : adresse vérifiée, zone, frais (recalculés ici, jamais reçus du navigateur)
  if v_place = 'home' and v_travel_on then
    if v_confirm then
      -- Adresse déjà vérifiée (jeton signé) lors de la création de la réservation temporaire.
      v_lat := v_hold.latitude; v_lng := v_hold.longitude; v_geo_postcode := v_hold.geo_postcode;
    else
      select g.lat, g.lng, g.postcode into v_lat, v_lng, v_geo_postcode from private.verify_geo(v_business, p -> 'geo') g;
    end if;
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
  if v_deposit > 0 and not v_confirm then
    -- Nouvelle tentative avec la même clé : on renvoie la réservation temporaire existante.
    select * into v_hold from public.booking_holds h
    where h.business_id = v_business and h.idempotency_key = v_key and h.status = 'open' and h.expires_at > now();
    if found then
      return jsonb_build_object('payment_required', true, 'existing', true, 'hold_id', v_hold.id,
        'deposit_cents', v_hold.deposit_cents, 'total_cents', v_hold.total_cents, 'travel_fee_cents', v_hold.travel_fee_cents,
        'service_name', v_service.name, 'stripe_account_id', v_hold.stripe_account_id, 'deposit_kind', v_hold.deposit_kind,
        'customer_email', v_hold.customer_email, 'enc_token', v_hold.enc_token,
        'checkout_session_id', v_hold.checkout_session_id, 'expires_at', v_hold.expires_at);
    end if;
    select * into v_acct from public.payment_accounts where business_id = v_business;
    if not found or not v_acct.charges_enabled then
      raise exception 'MOKA_PAYMENT_UNAVAILABLE' using errcode = 'P0001';
    end if;
    if (select count(*) from public.booking_holds h where h.business_id = v_business and h.created_at > now() - interval '1 hour') >= 30
       or (select count(*) from public.booking_holds h where h.business_id = v_business and h.customer_email = v_email
           and h.created_at > now() - interval '24 hours') >= 5 then
      raise exception 'MOKA_RATE_LIMITED' using errcode = 'P0001';
    end if;
  end if;

  if not v_confirm and (select count(*) from public.appointments a
      where a.business_id = v_business and a.source = 'online' and a.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'MOKA_RATE_LIMITED' using errcode = 'P0001';
  end if;
  if not v_confirm and (select count(*) from public.appointments a
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

  -- Avec arrhes : essai complet (cliente, adresse, rendez-vous, déclencheurs de
  -- disponibilité et de trajet) puis annulation, avant de bloquer le créneau.
  begin
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
      v_line1, v_line2, v_postal, v_city, v_total + v_fee, v_deposit, v_total + v_fee - v_deposit, v_comment,
      jsonb_build_object(
        'cancellation_notice_hours', v_settings.cancellation_notice_hours,
        'customer_can_cancel', v_settings.customer_can_cancel,
        'customer_can_reschedule', v_settings.customer_can_reschedule,
        'cancellation_policy', v_settings.cancellation_policy,
        'booking_terms', v_settings.booking_terms,
        'terms_accepted_at', now(),
        'customer_name', v_first || ' ' || v_last,
        'customer_email', v_email,
        'customer_phone', v_phone,
        'deposit_cents', v_deposit,
        'deposit_kind', case when v_deposit > 0 then coalesce(v_fin.deposit_kind, 'arrhes') end,
        'deposit_terms', case when v_deposit > 0 then v_fin.deposit_terms end
      ),
      v_key, v_hash, v_lat, v_lng
    ) returning id into v_appointment;
  exception
    when exclusion_violation then
      raise exception 'MOKA_SLOT_TAKEN' using errcode = 'P0001';
    when unique_violation then
      raise exception 'MOKA_DUPLICATE' using errcode = 'P0001';
  end;
  if v_deposit > 0 and not v_confirm then
    raise exception 'MOKA_DRY_RUN_OK' using errcode = 'P0001';
  end if;
  exception when raise_exception then
    if sqlerrm <> 'MOKA_DRY_RUN_OK' then
      raise;
    end if;
  end;

  if v_deposit > 0 and not v_confirm then
    insert into public.booking_holds (business_id, place, occupied, service_id, token_hash, expires_at, status, payload,
      enc_token, total_cents, deposit_cents, travel_fee_cents, customer_email, idempotency_key, latitude, longitude,
      geo_postcode, deposit_kind, stripe_account_id)
    values (v_business, v_place, v_range, v_service.id, v_hash, now() + interval '35 minutes', 'open',
      p - 'geo' - 'enc_token', left(p ->> 'enc_token', 400), v_total + v_fee, v_deposit, v_fee, v_email, v_key,
      v_lat, v_lng, v_geo_postcode, coalesce(v_fin.deposit_kind, 'arrhes'), v_acct.stripe_account_id)
    returning id into v_hold_id;
    return jsonb_build_object('payment_required', true, 'existing', false, 'hold_id', v_hold_id,
      'deposit_cents', v_deposit, 'total_cents', v_total + v_fee, 'travel_fee_cents', v_fee,
      'service_name', v_service.name, 'stripe_account_id', v_acct.stripe_account_id,
      'deposit_kind', coalesce(v_fin.deposit_kind, 'arrhes'), 'customer_email', v_email,
      'enc_token', left(p ->> 'enc_token', 400), 'checkout_session_id', null,
      'expires_at', now() + interval '35 minutes');
  end if;

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
    v_service.deposit_type, v_deposit, v_costs.consumables, v_costs.products, v_costs.other
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
revoke all on function private.online_booking(jsonb, uuid) from public;

create or replace function public.public_create_booking(p jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.online_booking(p, null) $$;

-- ─── Confirmation d'une réservation payée (appelée par le serveur) ──
-- Protocole : verrou de l'agenda, nouvelle vérification complète du
-- créneau, création du rendez-vous et du paiement dans la même
-- transaction. Si le créneau ne peut plus être honoré, le paiement est
-- enregistré et un remboursement intégral est demandé (jamais de double
-- réservation : session Stripe unique + clé d'idempotence + exclusion).
create or replace function private.confirm_paid_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session text := p ->> 'session_id';
  v_amount integer := (p ->> 'amount_cents')::integer;
  v_hold public.booking_holds%rowtype;
  v_business uuid;
  v_payment uuid;
  v_appt uuid;
  v_customer uuid;
  v_res jsonb;
  v_err text;
  v_refund uuid;
  v_existing record;
begin
  if v_session is null or v_amount is null or v_amount <= 0 or p ->> 'payment_intent_id' is null then
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end if;

  select id, appointment_id into v_existing from public.payments where stripe_checkout_session_id = v_session;
  if found then
    return jsonb_build_object('outcome', 'already', 'payment_id', v_existing.id, 'appointment_id', v_existing.appointment_id);
  end if;

  select * into v_hold from public.booking_holds where checkout_session_id = v_session for update;
  if not found then
    select business_id into v_business from public.payment_accounts where stripe_account_id = p ->> 'account';
    if v_business is null then
      return jsonb_build_object('outcome', 'ignored');
    end if;
    v_err := 'MOKA_UNKNOWN_SESSION';
  else
    v_business := v_hold.business_id;
    if v_hold.status = 'converted' then
      return jsonb_build_object('outcome', 'already', 'appointment_id', v_hold.appointment_id);
    end if;
    if v_amount <> v_hold.deposit_cents or lower(coalesce(p ->> 'currency', '')) <> v_hold.currency
       or (p ->> 'account') is distinct from v_hold.stripe_account_id then
      v_err := 'MOKA_AMOUNT_MISMATCH';
    elsif v_hold.status not in ('open', 'expired', 'cancelled') then
      v_err := 'MOKA_HOLD_CLOSED';
    else
      -- Libère sa propre réservation temporaire avant la vérification du créneau.
      update public.booking_holds set expires_at = least(expires_at, now()), updated_at = now() where id = v_hold.id;
      begin
        v_res := private.online_booking(v_hold.payload || jsonb_build_object('token_hash', v_hold.token_hash), v_hold.id);
        v_appt := (v_res ->> 'appointment_id')::uuid;
      exception when others then
        v_err := left(sqlerrm, 80);
      end;
    end if;
  end if;

  if v_appt is not null then
    select customer_id into v_customer from public.appointments where id = v_appt;
  end if;
  insert into public.payments (business_id, appointment_id, customer_id, kind, method, status, amount_cents, currency,
    fee_cents, livemode, stripe_account_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id,
    stripe_balance_transaction_id, available_on, received_at, validated_at)
  values (v_business, v_appt, v_customer, 'deposit', 'card_online', 'succeeded', v_amount, lower(coalesce(p ->> 'currency', 'eur')),
    nullif(p ->> 'fee_cents', '')::integer, coalesce((p ->> 'livemode')::boolean, false), p ->> 'account', v_session,
    p ->> 'payment_intent_id', p ->> 'charge_id', p ->> 'balance_transaction_id',
    case when p ->> 'available_on' is not null then to_timestamp((p ->> 'available_on')::bigint) end,
    coalesce(to_timestamp(nullif(p ->> 'paid_epoch', '')::bigint), now()), now())
  returning id into v_payment;

  if v_err is null then
    update public.booking_holds set status = 'converted', appointment_id = v_appt, updated_at = now() where id = v_hold.id;
    return jsonb_build_object('outcome', case when (v_res ->> 'duplicate')::boolean then 'already' else 'confirmed' end,
      'payment_id', v_payment, 'appointment_id', v_appt, 'notifications', coalesce(v_res -> 'notifications', '[]'::jsonb),
      'enc_token', v_hold.enc_token, 'token_hash', v_hold.token_hash);
  end if;

  if v_hold.id is not null then
    update public.booking_holds set status = 'refund_required', error_code = v_err, expires_at = least(expires_at, now()),
      updated_at = now() where id = v_hold.id;
  end if;
  insert into public.refunds (business_id, payment_id, amount_cents, status, reason, note)
  values (v_business, v_payment, v_amount, 'requested',
          case when v_err = 'MOKA_AMOUNT_MISMATCH' then 'amount_mismatch' else 'slot_unavailable' end,
          'Remboursement automatique : la réservation n''a pas pu être confirmée (' || v_err || ').')
  returning id into v_refund;
  return jsonb_build_object('outcome', 'refund_required', 'error', v_err, 'payment_id', v_payment, 'refund_id', v_refund,
    'amount_cents', v_amount, 'payment_intent_id', p ->> 'payment_intent_id', 'stripe_account_id', p ->> 'account',
    'business_id', v_business, 'customer_email', v_hold.customer_email);
end;
$$;
revoke all on function private.confirm_paid_hold(jsonb) from public;

-- ─── Opérations serveur signées (webhook Stripe, onboarding) ────────
-- Message signé : pay|v1|<op>|<ts>|<payload exact>. Fraîcheur ≤ 5 min.
create or replace function public.server_payment_op(p_op text, p_payload text, p_ts bigint, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p jsonb;
  v_business uuid;
  v_payment public.payments%rowtype;
  v_status text;
  v_event_at timestamptz;
  v_prev text;
  v_count integer;
begin
  if p_op is null or p_payload is null or p_ts is null
     or not private.signature_ok(concat_ws('|', 'pay', 'v1', p_op, p_ts::text, p_payload), p_signature)
     or abs(extract(epoch from now()) - p_ts) > 300 then
    raise exception 'MOKA_BAD_SIGNATURE' using errcode = 'P0001';
  end if;
  p := p_payload::jsonb;
  v_event_at := case when p ? 'event_at' then to_timestamp((p ->> 'event_at')::bigint) end;

  case p_op
  when 'event_begin' then
    select status into v_prev from public.payment_events where id = p ->> 'id' for update;
    if found then
      if v_prev in ('processed', 'ignored') then
        return jsonb_build_object('duplicate', true);
      end if;
      update public.payment_events set attempts = attempts + 1, status = 'processing' where id = p ->> 'id';
      return jsonb_build_object('duplicate', false, 'retry', true);
    end if;
    insert into public.payment_events (id, business_id, type, stripe_account_id, livemode, stripe_created_at)
    values (p ->> 'id', (select business_id from public.payment_accounts where stripe_account_id = p ->> 'account'),
            p ->> 'type', p ->> 'account', coalesce((p ->> 'livemode')::boolean, false), to_timestamp((p ->> 'created')::bigint));
    return jsonb_build_object('duplicate', false, 'retry', false);

  when 'event_finish' then
    update public.payment_events set status = p ->> 'status', outcome = left(p ->> 'outcome', 80),
      last_error = left(p ->> 'error', 200),
      business_id = coalesce(business_id, (select business_id from public.payment_accounts where stripe_account_id = public.payment_events.stripe_account_id)),
      processed_at = case when p ->> 'status' in ('processed', 'ignored') then now() end
    where id = p ->> 'id';
    return jsonb_build_object('ok', true);

  when 'account_link' then
    v_business := (p ->> 'business_id')::uuid;
    if exists (select 1 from public.payment_accounts where stripe_account_id = p ->> 'stripe_account_id' and business_id <> v_business) then
      raise exception 'MOKA_ACCOUNT_IN_USE' using errcode = 'P0001';
    end if;
    insert into public.payment_accounts (business_id, stripe_account_id, livemode)
    values (v_business, p ->> 'stripe_account_id', coalesce((p ->> 'livemode')::boolean, false))
    on conflict (business_id) do update set stripe_account_id = excluded.stripe_account_id, livemode = excluded.livemode,
      charges_enabled = case when public.payment_accounts.stripe_account_id = excluded.stripe_account_id then public.payment_accounts.charges_enabled else false end,
      payouts_enabled = case when public.payment_accounts.stripe_account_id = excluded.stripe_account_id then public.payment_accounts.payouts_enabled else false end,
      details_submitted = case when public.payment_accounts.stripe_account_id = excluded.stripe_account_id then public.payment_accounts.details_submitted else false end,
      last_event_at = case when public.payment_accounts.stripe_account_id = excluded.stripe_account_id then public.payment_accounts.last_event_at end,
      updated_at = now();
    return jsonb_build_object('ok', true);

  when 'account_sync' then
    update public.payment_accounts set
      charges_enabled = coalesce((p ->> 'charges_enabled')::boolean, false),
      payouts_enabled = coalesce((p ->> 'payouts_enabled')::boolean, false),
      details_submitted = coalesce((p ->> 'details_submitted')::boolean, false),
      requirements_due = coalesce((select array_agg(left(x, 120)) from jsonb_array_elements_text(p -> 'requirements_due') x), '{}'),
      disabled_reason = left(p ->> 'disabled_reason', 200),
      country = left(p ->> 'country', 2),
      default_currency = lower(p ->> 'default_currency'),
      livemode = coalesce((p ->> 'livemode')::boolean, livemode),
      last_event_at = coalesce(v_event_at, last_event_at),
      updated_at = now()
    where stripe_account_id = p ->> 'stripe_account_id'
      and (v_event_at is null or last_event_at is null or last_event_at <= v_event_at)
    returning business_id into v_business;
    return jsonb_build_object('business_id', v_business);

  when 'checkout_attach' then
    update public.booking_holds set checkout_session_id = p ->> 'session_id', updated_at = now()
    where id = (p ->> 'hold_id')::uuid and status = 'open'
      and (checkout_session_id is null or checkout_session_id = p ->> 'session_id');
    get diagnostics v_count = row_count;
    return jsonb_build_object('ok', v_count = 1);

  when 'hold_cancel' then
    update public.booking_holds set status = 'cancelled', expires_at = least(expires_at, now()), updated_at = now()
    where id = (p ->> 'hold_id')::uuid and status = 'open';
    get diagnostics v_count = row_count;
    return jsonb_build_object('ok', v_count = 1);

  when 'checkout_expired' then
    update public.booking_holds set status = 'expired', expires_at = least(expires_at, now()), updated_at = now()
    where checkout_session_id = p ->> 'session_id' and status = 'open';
    get diagnostics v_count = row_count;
    return jsonb_build_object('released', v_count = 1);

  when 'checkout_completed' then
    return private.confirm_paid_hold(p);

  when 'payment_fee' then
    update public.payments set fee_cents = (p ->> 'fee_cents')::integer,
      stripe_balance_transaction_id = coalesce(stripe_balance_transaction_id, p ->> 'balance_transaction_id'),
      stripe_charge_id = coalesce(stripe_charge_id, p ->> 'charge_id'),
      available_on = coalesce(available_on, to_timestamp(nullif(p ->> 'available_on', '')::bigint))
    where stripe_payment_intent_id = p ->> 'payment_intent_id' and fee_cents is null;
    get diagnostics v_count = row_count;
    return jsonb_build_object('updated', v_count = 1);

  when 'refund_sync' then
    v_status := case p ->> 'status' when 'succeeded' then 'succeeded' when 'failed' then 'failed'
                  when 'canceled' then 'canceled' else 'pending' end;
    if p ->> 'refund_row_id' is not null then
      update public.refunds set stripe_refund_id = coalesce(stripe_refund_id, p ->> 'stripe_refund_id'),
        status = case when status in ('succeeded', 'failed', 'canceled') then status else v_status end,
        failure_reason = coalesce(left(p ->> 'failure_reason', 200), failure_reason),
        processed_at = case when v_status in ('succeeded', 'failed', 'canceled') and processed_at is null then now() else processed_at end,
        last_event_at = coalesce(v_event_at, last_event_at)
      where id = (p ->> 'refund_row_id')::uuid
      returning business_id into v_business;
      return jsonb_build_object('business_id', v_business);
    end if;
    update public.refunds set
      status = case when status in ('succeeded', 'failed', 'canceled') then status else v_status end,
      failure_reason = coalesce(left(p ->> 'failure_reason', 200), failure_reason),
      processed_at = case when v_status in ('succeeded', 'failed', 'canceled') and processed_at is null then now() else processed_at end,
      last_event_at = coalesce(v_event_at, last_event_at)
    where stripe_refund_id = p ->> 'stripe_refund_id'
      and (v_event_at is null or last_event_at is null or last_event_at <= v_event_at)
    returning business_id into v_business;
    if found or exists (select 1 from public.refunds where stripe_refund_id = p ->> 'stripe_refund_id') then
      return jsonb_build_object('business_id', v_business);
    end if;
    -- Remboursement fait depuis le tableau de bord Stripe : on l'ajoute au registre.
    select * into v_payment from public.payments where stripe_payment_intent_id = p ->> 'payment_intent_id' for update;
    if not found then
      raise exception 'MOKA_PAYMENT_UNKNOWN' using errcode = 'P0001';
    end if;
    -- Un remboursement demandé depuis Moka peut ne pas encore avoir reçu son identifiant Stripe.
    update public.refunds set stripe_refund_id = p ->> 'stripe_refund_id',
      status = case when status in ('succeeded', 'failed', 'canceled') then status else v_status end,
      processed_at = case when v_status in ('succeeded', 'failed', 'canceled') then now() end,
      last_event_at = v_event_at
    where id = (select r.id from public.refunds r where r.payment_id = v_payment.id and r.stripe_refund_id is null
                  and r.status = 'requested' and r.amount_cents = (p ->> 'amount_cents')::integer
                order by r.created_at limit 1)
    returning business_id into v_business;
    if found then
      return jsonb_build_object('business_id', v_business);
    end if;
    insert into public.refunds (business_id, payment_id, amount_cents, status, reason, note, stripe_refund_id, last_event_at, processed_at)
    values (v_payment.business_id, v_payment.id, (p ->> 'amount_cents')::integer, v_status, 'other',
            'Remboursement effectué depuis le tableau de bord Stripe.', p ->> 'stripe_refund_id', v_event_at,
            case when v_status in ('succeeded', 'failed', 'canceled') then now() end);
    return jsonb_build_object('business_id', v_payment.business_id, 'created', true);

  when 'dispute_sync' then
    select * into v_payment from public.payments where stripe_payment_intent_id = p ->> 'payment_intent_id';
    if not found then
      raise exception 'MOKA_PAYMENT_UNKNOWN' using errcode = 'P0001';
    end if;
    insert into public.payment_disputes (business_id, payment_id, stripe_dispute_id, amount_cents, status, reason, evidence_due_by, last_event_at)
    values (v_payment.business_id, v_payment.id, p ->> 'dispute_id', (p ->> 'amount_cents')::integer, left(p ->> 'status', 40),
            left(p ->> 'reason', 60), to_timestamp(nullif(p ->> 'evidence_due_by', '')::bigint), v_event_at)
    on conflict (stripe_dispute_id) do update set status = excluded.status, amount_cents = excluded.amount_cents,
      evidence_due_by = excluded.evidence_due_by, last_event_at = excluded.last_event_at, updated_at = now()
    where public.payment_disputes.last_event_at is null or excluded.last_event_at is null
       or public.payment_disputes.last_event_at <= excluded.last_event_at;
    return jsonb_build_object('business_id', v_payment.business_id);

  when 'payout_sync' then
    select business_id into v_business from public.payment_accounts where stripe_account_id = p ->> 'stripe_account_id';
    if v_business is null then
      return jsonb_build_object('ignored', true);
    end if;
    insert into public.payouts (business_id, stripe_payout_id, amount_cents, currency, status, arrival_date, last_event_at)
    values (v_business, p ->> 'payout_id', (p ->> 'amount_cents')::integer, lower(coalesce(p ->> 'currency', 'eur')),
            p ->> 'status', to_timestamp(nullif(p ->> 'arrival_epoch', '')::bigint), v_event_at)
    on conflict (stripe_payout_id) do update set status = excluded.status, amount_cents = excluded.amount_cents,
      arrival_date = excluded.arrival_date, last_event_at = excluded.last_event_at, updated_at = now()
    where public.payouts.last_event_at is null or excluded.last_event_at is null
       or public.payouts.last_event_at <= excluded.last_event_at;
    return jsonb_build_object('business_id', v_business);

  else
    raise exception 'MOKA_INVALID_INPUT' using errcode = 'P0001';
  end case;
end;
$$;
revoke all on function public.server_payment_op(text, text, bigint, text) from public;
grant execute on function public.server_payment_op(text, text, bigint, text) to anon, authenticated;

-- ─── Suivi du paiement par la cliente (lien privé) ──────────────────
create or replace function public.public_hold_status(p_hold uuid, p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', case when h.status = 'open' and h.expires_at <= now() then 'expired' else h.status end,
    'deposit_cents', h.deposit_cents, 'total_cents', h.total_cents, 'deposit_kind', h.deposit_kind,
    'starts_at', lower(h.occupied) + make_interval(mins => coalesce(s.prep_minutes, 0)),
    'service_name', s.name, 'expires_at', h.expires_at, 'checkout_session_id', h.checkout_session_id,
    'stripe_account_id', h.stripe_account_id, 'enc_token', h.enc_token, 'slug', b.slug)
  from public.booking_holds h
  join public.businesses b on b.id = h.business_id
  left join public.services s on s.id = h.service_id
  where p_token_hash ~ '^[0-9a-f]{64}$' and h.id = p_hold and h.token_hash = p_token_hash;
$$;
revoke all on function public.public_hold_status(uuid, text) from public;
grant execute on function public.public_hold_status(uuid, text) to anon, authenticated;
