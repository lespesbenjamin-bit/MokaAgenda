import fixtures from "../../../supabase/demo/fixtures.json";

/**
 * Transforme les fixtures démo en lignes prêtes à insérer, avec des
 * identifiants générés à l'avance (les relations sont ainsi connues).
 * Fonction pure : utilisée par la réinitialisation démo ET par les tests
 * qui insèrent réellement ces lignes dans PostgreSQL.
 */
export function buildDemoRows(businessId: string, newId: () => string = () => crypto.randomUUID()) {
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

  return { categories, services, service_locations, service_costs, customers, customer_addresses, customer_consents };
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
  };
}
