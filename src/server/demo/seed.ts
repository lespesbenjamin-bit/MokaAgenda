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
