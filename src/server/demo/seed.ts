import fixtures from "../../../supabase/demo/fixtures.json";
import { depositAmountCents, excludingVatCents, totalPriceCents, type DepositType, type Place, type ServicePricing } from "../../lib/domain/pricing";
import { addDays, isoWeekdayOf, localDate, zonedToUtc } from "../../lib/domain/time";

/**
 * Transforme les fixtures démo en lignes prêtes à insérer, avec des
 * identifiants générés à l'avance (les relations sont ainsi connues).
 * Fonction pure : utilisée par la réinitialisation démo ET par les tests
 * qui insèrent réellement ces lignes dans PostgreSQL.
 */
export function buildDemoRows(businessId: string, newId: () => string = () => crypto.randomUUID(), now: Date = new Date(), timeZone = "Europe/Paris") {
  const categories = fixtures.categories.map((c) => ({
    id: newId(),
    business_id: businessId,
    name: c.name,
    description: c.description,
    position: c.position,
    is_visible: true,
  }));

  const services: Record<string, unknown>[] = [];
  const service_locations: Record<string, unknown>[] = [];
  const service_costs: Record<string, unknown>[] = [];
  for (const s of fixtures.services) {
    const id = newId();
    services.push({
      id,
      business_id: businessId,
      category_id: categories[s.category].id,
      name: s.name,
      duration_minutes: s.duration_minutes,
      prep_minutes: s.prep_minutes,
      cleanup_minutes: s.cleanup_minutes,
      buffer_minutes: s.buffer_minutes,
      base_price_cents: s.base_price_cents,
      vat_rate_bps: s.vat_rate_bps,
      deposit_type: s.deposit_type,
      deposit_value: s.deposit_value,
      online_bookable: s.online_bookable,
      is_active: true,
    });
    for (const [place, price] of Object.entries(s.places)) {
      service_locations.push({ business_id: businessId, service_id: id, place, price_cents: price });
    }
    for (const [kind, amount] of Object.entries(s.costs)) {
      if (amount > 0) service_costs.push({ business_id: businessId, service_id: id, kind, amount_cents: amount });
    }
  }

  const customers: Record<string, unknown>[] = [];
  const customer_addresses: Record<string, unknown>[] = [];
  const customer_consents: Record<string, unknown>[] = [];
  for (const c of fixtures.customers) {
    const id = newId();
    customers.push({
      id,
      business_id: businessId,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      notes: c.notes,
      contact_preference: c.contact_preference,
      source: "manual",
    });
    for (const a of c.addresses) {
      customer_addresses.push({
        id: newId(),
        business_id: businessId,
        customer_id: id,
        kind: a.kind,
        label: "label" in a ? a.label : null,
        line1: a.line1,
        postal_code: a.postal_code,
        city: a.city,
        is_primary: a.is_primary,
      });
    }
    for (const [channel, granted] of Object.entries(c.consents)) {
      customer_consents.push({ business_id: businessId, customer_id: id, channel, granted, purpose: "marketing", source: "manual" });
    }
  }

  // ─── Agenda (Sprint 3) : horaires, blocages, rendez-vous cohérents ───
  const availability_rules = fixtures.availability.map((r) => ({
    business_id: businessId,
    weekday: r.weekday,
    start_minute: r.start,
    end_minute: r.end,
    place: r.place,
  }));
  const today = localDate(now, timeZone);
  const availability_exceptions = fixtures.exceptions.map((e) => ({
    business_id: businessId,
    kind: e.kind,
    label: e.label,
    starts_at: zonedToUtc(addDays(today, e.from_day_offset), 0, timeZone).toISOString(),
    ends_at: zonedToUtc(addDays(today, e.from_day_offset + e.days), 0, timeZone).toISOString(),
    place: e.place,
  }));
  const blockedDays = new Set<string>();
  for (const e of fixtures.exceptions) for (let d = 0; d < e.days; d++) blockedDays.add(addDays(today, e.from_day_offset + d));

  const appointments: Record<string, unknown>[] = [];
  const appointment_items: Record<string, unknown>[] = [];
  const pricingOf = (i: number): ServicePricing => {
    const s = fixtures.services[i];
    return {
      basePriceCents: s.base_price_cents,
      promoPriceCents: null,
      extraFeeCents: 0,
      vatRateBps: s.vat_rate_bps,
      places: s.places as ServicePricing["places"],
      depositType: s.deposit_type as DepositType,
      depositValue: s.deposit_value,
    };
  };
  const win = fixtures.appointments_window;
  let n = 0;
  for (let offset = -win.past_days; offset <= win.future_days; offset++) {
    const day = addDays(today, offset);
    if (blockedDays.has(day)) continue;
    const weekday = isoWeekdayOf(day);
    fixtures.availability.forEach((rule, ri) => {
      if (rule.weekday !== weekday) return;
      const place = (rule.place ?? "salon") as Place;
      const candidates = fixtures.services.map((s, i) => ({ s, i })).filter(({ s }) => place in s.places);
      let cursor = rule.start + 30 + (Math.abs(offset) % 2) * 30;
      for (let k = 0; k < win.per_range; k++) {
        const { s, i } = candidates[(Math.abs(offset) * 3 + ri * 5 + k * 7) % candidates.length];
        const start = Math.max(cursor, rule.start + s.prep_minutes);
        const occupiedEnd = start + s.duration_minutes + s.cleanup_minutes + s.buffer_minutes;
        if (occupiedEnd > rule.end) break;
        const startsAt = zonedToUtc(day, start, timeZone);
        const endsAt = new Date(startsAt.getTime() + s.duration_minutes * 60_000);
        n++;
        const past = endsAt <= now || startsAt <= now;
        const status = past ? (n % 9 === 0 ? "no_show" : n % 7 === 0 ? "cancelled" : "completed") : n % 5 === 0 ? "pending" : "confirmed";
        const customerIndex = (n * 7) % customers.length;
        const customer = customers[customerIndex];
        const address = customer_addresses.find((a) => a.customer_id === customer.id && a.is_primary)!;
        const pricing = pricingOf(i);
        const price = totalPriceCents(pricing, place);
        const deposit = depositAmountCents(pricing, price);
        const id = newId();
        // Quelques rendez-vous à venir « pris en ligne » (fictifs) pour illustrer la réservation publique
        const online = !past && n % 4 === 0 && s.deposit_type === "none";
        appointments.push({
          id,
          business_id: businessId,
          customer_id: customer.id,
          place,
          status,
          starts_at: startsAt.toISOString(),
          duration_minutes: s.duration_minutes,
          prep_minutes: s.prep_minutes,
          cleanup_minutes: s.cleanup_minutes,
          buffer_minutes: s.buffer_minutes,
          address_id: place === "home" ? address.id : null,
          address_line1: place === "home" ? address.line1 : null,
          postal_code: place === "home" ? address.postal_code : null,
          city: place === "home" ? address.city : null,
          price_total_cents: price,
          deposit_amount_cents: deposit,
          balance_due_cents: price - deposit,
          cancel_reason: status === "cancelled" ? "Annulation fictive (démo)" : null,
          source: online ? "online" : "manual",
          customer_comment: online ? "Message fictif laissé lors de la réservation en ligne (démo)." : null,
        });
        appointment_items.push({
          business_id: businessId,
          appointment_id: id,
          service_id: services[i].id,
          position: 1,
          service_name: s.name,
          duration_minutes: s.duration_minutes,
          catalog_price_cents: price,
          unit_price_cents: price,
          vat_rate_bps: s.vat_rate_bps,
          price_ht_cents: excludingVatCents(price, s.vat_rate_bps),
          deposit_type: s.deposit_type,
          deposit_amount_cents: deposit,
          consumables_cents: s.costs.consumables,
          products_cents: s.costs.products,
          other_costs_cents: s.costs.other,
        });
        cursor = Math.ceil((occupiedEnd + 30) / 15) * 15;
      }
    });
  }

  return {
    categories,
    services,
    service_locations,
    service_costs,
    customers,
    customer_addresses,
    customer_consents,
    availability_rules,
    availability_exceptions,
    appointments,
    appointment_items,
  };
}

/** Ordre d'insertion respectant les clés étrangères. */
export const DEMO_TABLE_ORDER = [
  "service_categories",
  "services",
  "service_locations",
  "service_costs",
  "customers",
  "customer_addresses",
  "customer_consents",
  "availability_rules",
  "availability_exceptions",
  "appointments",
  "appointment_items",
] as const;

export function rowsByTable(rows: ReturnType<typeof buildDemoRows>): Record<(typeof DEMO_TABLE_ORDER)[number], Record<string, unknown>[]> {
  return {
    service_categories: rows.categories,
    services: rows.services,
    service_locations: rows.service_locations,
    service_costs: rows.service_costs,
    customers: rows.customers,
    customer_addresses: rows.customer_addresses,
    customer_consents: rows.customer_consents,
    availability_rules: rows.availability_rules,
    availability_exceptions: rows.availability_exceptions,
    appointments: rows.appointments,
    appointment_items: rows.appointment_items,
  };
}

type ExtraBusiness = (typeof fixtures.extra_businesses)[number];

/**
 * Professionnelles fictives supplémentaires (Sprint 5) : une 100 % à domicile,
 * une 100 % en institut. Catalogue réduit, horaires, véhicule et zones ; pas
 * de clientes (elles servent à tester la réservation en ligne).
 */
export function buildExtraBusinessRows(extra: ExtraBusiness, businessId: string, newId: () => string = () => crypto.randomUUID()) {
  const services: Record<string, unknown>[] = [];
  const service_locations: Record<string, unknown>[] = [];
  for (const name of extra.services) {
    const s = fixtures.services.find((x) => x.name === name)!;
    const id = newId();
    services.push({
      id,
      business_id: businessId,
      name: s.name,
      duration_minutes: s.duration_minutes,
      prep_minutes: s.prep_minutes,
      cleanup_minutes: s.cleanup_minutes,
      buffer_minutes: s.buffer_minutes,
      base_price_cents: s.base_price_cents,
      vat_rate_bps: s.vat_rate_bps,
      deposit_type: s.deposit_type,
      deposit_value: s.deposit_value,
      online_bookable: s.online_bookable,
      is_active: true,
    });
    for (const place of extra.places) {
      const price = (s.places as Record<string, number | null>)[place];
      service_locations.push({ business_id: businessId, service_id: id, place, price_cents: price ?? null });
    }
  }
  const availability_rules = extra.availability.map((r) => ({ business_id: businessId, weekday: r.weekday, start_minute: r.start, end_minute: r.end, place: r.place }));
  return { services, service_locations, availability_rules };
}

/** Véhicule et zones d'une configuration de déplacement fictive. */
export function buildTravelRows(travel: { vehicle: Record<string, unknown>; areas: Record<string, unknown>[] }, businessId: string) {
  return {
    vehicles: [{ ...travel.vehicle, business_id: businessId }],
    service_areas: travel.areas.map((a) => ({ ...a, business_id: businessId })),
  };
}

/**
 * Finances fictives (Sprint 6), cohérentes avec les rendez-vous générés :
 * arrhes « en ligne » (identifiants Stripe fictifs préfixés demo), soldes,
 * quelques soldes non réglés, un règlement à valider, des arrhes remboursées,
 * des virements Stripe, charges fixes, paramètres et objectifs.
 * Aucune donnée réelle, aucun appel à Stripe.
 */
export function buildFinanceDemoRows(rows: ReturnType<typeof buildDemoRows>, businessId: string, now: Date = new Date(), newId: () => string = () => crypto.randomUUID()) {
  const f = fixtures.finance;
  const payments: Record<string, unknown>[] = [];
  const refunds: Record<string, unknown>[] = [];
  const payouts: Record<string, unknown>[] = [];
  const stripeFee = (cents: number) => Math.round(cents * 0.015) + 25; // tarif standard cartes EEE, valeur d'exemple
  let k = 0;
  const methods = ["card_terminal", "cash", "card_terminal", "transfer"] as const;
  for (const a of rows.appointments as { id: string; customer_id: string; status: string; starts_at: string; price_total_cents: number; deposit_amount_cents: number }[]) {
    k++;
    const start = new Date(a.starts_at);
    const paidAt = (minutesBefore: number) => new Date(start.getTime() - minutesBefore * 60_000).toISOString();
    const base = { business_id: businessId, appointment_id: a.id, customer_id: a.customer_id, currency: "eur" };
    let depositId: string | null = null;
    if (a.deposit_amount_cents > 0 && a.status !== "pending") {
      depositId = newId();
      payments.push({
        ...base, id: depositId, kind: "deposit", method: "card_online", status: "succeeded", amount_cents: a.deposit_amount_cents,
        fee_cents: stripeFee(a.deposit_amount_cents), livemode: false, stripe_payment_intent_id: `pi_demo_${k}`, stripe_checkout_session_id: `cs_demo_${k}`,
        received_at: paidAt(3 * 24 * 60), validated_at: paidAt(3 * 24 * 60),
      });
    }
    if (a.status === "completed" && start <= now) {
      const balance = a.price_total_cents - (depositId ? a.deposit_amount_cents : 0);
      if (balance > 0 && k % 11 !== 0) {
        const pending = k % 17 === 0 && now.getTime() - start.getTime() < 7 * 86_400_000;
        payments.push({
          ...base, id: newId(), kind: "balance", method: methods[k % methods.length], status: pending ? "pending" : "succeeded", amount_cents: balance,
          received_at: new Date(start.getTime() + 90 * 60_000).toISOString(), validated_at: pending ? null : new Date(start.getTime() + 90 * 60_000).toISOString(),
          note: pending ? "Virement annoncé par la cliente (fictif)" : null,
        });
      }
    }
    if (a.status === "cancelled" && depositId && k % 2 === 0) {
      refunds.push({ business_id: businessId, payment_id: depositId, amount_cents: a.deposit_amount_cents, status: "succeeded", reason: "cancellation", stripe_refund_id: `re_demo_${k}`, created_at: paidAt(24 * 60), processed_at: paidAt(24 * 60), note: "Remboursement fictif (démo)" });
    }
  }
  // Au moins un remboursement partiel fictif (geste commercial) pour illustrer l'historique.
  const firstOnline = payments.find((p) => p.method === "card_online" && p.status === "succeeded" && !refunds.some((r) => r.payment_id === p.id));
  if (firstOnline) {
    const at = new Date(new Date(firstOnline.received_at as string).getTime() + 86_400_000).toISOString();
    refunds.push({ business_id: businessId, payment_id: firstOnline.id, amount_cents: Math.min(500, firstOnline.amount_cents as number), status: "succeeded", reason: "customer_request", stripe_refund_id: "re_demo_geste", created_at: at, processed_at: at, note: "Geste commercial fictif (démo)" });
  }
  // Virements Stripe hebdomadaires fictifs (somme des arrhes nettes de frais de la semaine précédente)
  const online = payments.filter((p) => p.method === "card_online");
  for (let w = 1; w <= 8; w++) {
    const to = new Date(now.getTime() - (w - 1) * 7 * 86_400_000);
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const sum = online.filter((p) => new Date(p.received_at as string) >= from && new Date(p.received_at as string) < to).reduce((s, p) => s + (p.amount_cents as number) - (p.fee_cents as number), 0);
    if (sum > 0) payouts.push({ business_id: businessId, stripe_payout_id: `po_demo_${w}`, amount_cents: sum, currency: "eur", status: "paid", arrival_date: new Date(to.getTime() + 2 * 86_400_000 > now.getTime() ? now.getTime() - 3600_000 : to.getTime() + 2 * 86_400_000).toISOString() });
  }
  const monthsAgo = (m: number) => {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - m, 1);
    return d.toISOString().slice(0, 10);
  };
  const fixed_expenses = f.fixed_expenses.map(({ months_ago, ...e }) => ({ business_id: businessId, ...e, starts_on: monthsAgo(months_ago) }));
  return { payments, refunds, payouts, fixed_expenses, settings: f.settings, goals: f.goals };
}
