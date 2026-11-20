/**
 * Sprint 5 — déplacements : signature des trajets, contrôle des enchaînements
 * (avant ET après), frais et zones recalculés par la base, protection des
 * adresses privées, isolation. Rôles réels (anon / authenticated), jamais service_role.
 *
 * Les distances et durées ci-dessous sont des VALEURS DE TEST saisies à la main
 * et signées comme le ferait le serveur : aucun appel au fournisseur ici.
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { as, connect, createUser } from "./helpers";
import { contextMessage, geoMessage, routeMessage, sign, type LatLng } from "@/server/travel/signing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let db: Client;
let secret: string;
let ownerA: string, ownerB: string, staffA: string;
let bizA: string, bizB: string, slugA: string;
let svc: string, svcCheap: string, customerA: string;
let dayStart: Date;

const BASE: LatLng = { lat: 43.6, lng: 1.4 };
const SALON: LatLng = { lat: 43.61, lng: 1.45 };
const P1: LatLng = { lat: 43.62, lng: 1.42 };
const P2: LatLng = { lat: 43.65, lng: 1.38 };
const P3: LatLng = { lat: 43.58, lng: 1.36 };

const one = async <T = Json>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;
const at = (hour: number, minute = 0, dayOffset = 0) => new Date(dayStart.getTime() + ((dayOffset * 24 + hour) * 60 + minute) * 60_000);
const tokenHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const epoch = (d = new Date()) => Math.floor(d.getTime() / 1000);

async function estimate(from: LatLng, to: LatLng, distanceM: number, durationS: number, { business = bizA, signature }: { business?: string; signature?: string } = {}) {
  const e = { businessId: business, from, to, distanceM, durationS, provider: "test", computedEpoch: epoch() };
  const p = { business_id: business, from_lat: from.lat, from_lng: from.lng, to_lat: to.lat, to_lng: to.lng, distance_m: distanceM, duration_s: durationS, provider: "test", computed_epoch: e.computedEpoch, signature: signature ?? sign(routeMessage(e), secret) };
  return as(db, null, () => db.query("select public.record_travel_estimate($1)", [JSON.stringify(p)]), { commit: true });
}

function geo(p: LatLng, postcode: string, { business = bizA, expires = epoch() + 3600, tamper = false } = {}) {
  const signature = sign(geoMessage({ businessId: business, lat: p.lat, lng: p.lng, postcode, expiresEpoch: expires }), secret);
  return { lat: tamper ? p.lat + 0.01 : p.lat, lng: p.lng, postcode, expires_epoch: expires, signature };
}

const pro = (sql: string, params: unknown[] = []) => as(db, ownerA, () => db.query(sql, params), { commit: true });

async function proAppointment(start: Date, place: "home" | "salon", coords: LatLng | null, extra: Json = {}) {
  const payload = {
    business_id: bizA,
    customer_id: customerA,
    place,
    starts_at: start.toISOString(),
    duration_minutes: 60,
    address_line1: place === "home" ? "Rue fictive" : "",
    city: place === "home" ? "Toulouse" : "",
    latitude: coords?.lat ?? "",
    longitude: coords?.lng ?? "",
    items: [{ service_id: svc, service_name: "Soin", duration_minutes: 60, catalog_price_cents: 5000, unit_price_cents: 5000, price_ht_cents: 5000 }],
    ...extra,
  };
  return as(db, ownerA, async () => (await one<{ id: string }>("select public.create_appointment($1) as id", [JSON.stringify(payload)])).id, { commit: true });
}

function booking(over: Json = {}) {
  return {
    slug: slugA,
    service_id: svc,
    place: "home",
    starts_at: at(16, 0, 1).toISOString(),
    first_name: "Nina",
    last_name: "Test",
    email: `n.${randomUUID().slice(0, 8)}@exemple.fr`,
    phone: `06${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    address_line1: "Rue publique fictive",
    postal_code: "31000",
    city: "Toulouse",
    accept_terms: true,
    idempotency_key: randomUUID(),
    token_hash: tokenHash(),
    ...over,
  };
}
const book = (p: Json) => as(db, null, async () => (await db.query("select public.public_create_booking($1) as r", [JSON.stringify(p)])).rows[0].r as Json, { commit: true });

beforeAll(async () => {
  db = await connect();
  secret = (await one<{ value: string }>("select value from private.app_secrets where name = 'travel_signing'")).value;
  ownerA = await createUser(db, "s5-a@example.fr");
  ownerB = await createUser(db, "s5-b@example.fr");
  staffA = await createUser(db, "s5-staff@example.fr");
  bizA = await as(db, ownerA, async () => (await one<{ id: string }>("select public.create_business('Domicile A', null, null, 'pro@a.fr') as id")).id, { commit: true });
  bizB = await as(db, ownerB, async () => (await one<{ id: string }>("select public.create_business('Domicile B') as id")).id, { commit: true });
  await db.query("insert into public.business_members (business_id, user_id, role) values ($1, $2, 'staff')", [bizA, staffA]);
  slugA = (await one<{ slug: string }>("select slug from public.businesses where id = $1", [bizA])).slug;
  dayStart = (await one<{ d: Date }>("select ((date_trunc('day', now() at time zone 'Europe/Paris') + interval '3 days') at time zone 'Europe/Paris') as d")).d;

  await as(
    db,
    ownerA,
    async () => {
      await db.query("update public.business_settings set booking_enabled = true where business_id = $1", [bizA]);
      await db.query("select public.replace_availability_rules($1, $2)", [bizA, JSON.stringify([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_minute: 480, end_minute: 1200, place: null })))]);
      await db.query(
        `insert into public.locations (business_id, kind, address_line1, postal_code, city, latitude, longitude, geocoded_at, geocode_label) values
         ($1, 'travel_base', 'Adresse privée de départ', '31000', 'Toulouse', $2, $3, now(), 'test'),
         ($1, 'salon', 'Institut', '31000', 'Toulouse', $4, $5, now(), 'test')`,
        [bizA, BASE.lat, BASE.lng, SALON.lat, SALON.lng],
      );
      svc = (await one<{ id: string }>("insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'Soin', 60, 5000) returning id", [bizA])).id;
      svcCheap = (await one<{ id: string }>("insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'Petit soin', 30, 1500) returning id", [bizA])).id;
      for (const s of [svc, svcCheap]) await db.query("insert into public.service_locations (business_id, service_id, place) values ($1, $2, 'home'), ($1, $2, 'salon')", [bizA, s]);
      customerA = (await one<{ id: string }>("insert into public.customers (business_id, first_name) values ($1, 'Léa') returning id", [bizA])).id;
      await db.query(
        `insert into public.vehicles (business_id, label, kind, consumption_per_100km, energy_unit, energy_price_millis, wear_cost_per_km_millis, hourly_time_cost_cents, is_default)
         values ($1, 'Citadine', 'car_fuel', 6.5, 'l', 1859, 120, 2000, true)`,
        [bizA],
      );
    },
    { commit: true },
  );
});
afterAll(async () => db?.end());

describe("clé et signatures", () => {
  it("la clé de signature est inaccessible sans compte comme avec compte", async () => {
    await expect(as(db, null, () => db.query("select value from private.app_secrets"))).rejects.toThrow(/permission denied/);
    await expect(as(db, ownerA, () => db.query("select value from private.app_secrets"))).rejects.toThrow(/permission denied/);
  });

  it("refuse un trajet non signé, mal signé ou périmé ; accepte un trajet signé", async () => {
    await expect(estimate(BASE, P1, 9000, 900, { signature: "0".repeat(64) })).rejects.toThrow("MOKA_BAD_SIGNATURE");
    const old = epoch() - 3 * 86400;
    const e = { businessId: bizA, from: BASE, to: P1, distanceM: 9000, durationS: 900, provider: "test", computedEpoch: old };
    const p = { business_id: bizA, from_lat: BASE.lat, from_lng: BASE.lng, to_lat: P1.lat, to_lng: P1.lng, distance_m: 9000, duration_s: 900, provider: "test", computed_epoch: old, signature: sign(routeMessage(e), secret) };
    await expect(as(db, null, () => db.query("select public.record_travel_estimate($1)", [JSON.stringify(p)]))).rejects.toThrow("MOKA_STALE_ESTIMATE");
    // Une distance modifiée après signature est refusée
    const good = { ...p, computed_epoch: epoch(), signature: sign(routeMessage({ ...e, computedEpoch: epoch() }), secret) };
    await expect(as(db, null, () => db.query("select public.record_travel_estimate($1)", [JSON.stringify({ ...good, distance_m: 100 })]))).rejects.toThrow("MOKA_BAD_SIGNATURE");
    await estimate(BASE, P1, 9000, 900);
    expect((await one("select distance_m from public.travel_estimates where business_id = $1 and to_lat = $2", [bizA, P1.lat])).distance_m).toBe(9000);
  });

  it("les trajets ne sont lisibles que par l'entreprise concernée", async () => {
    await expect(as(db, null, () => db.query("select 1 from public.travel_estimates"))).rejects.toThrow(/permission denied/);
    expect((await as(db, ownerB, () => db.query("select 1 from public.travel_estimates where business_id = $1", [bizA]))).rowCount).toBe(0);
    expect((await as(db, ownerA, () => db.query("select 1 from public.travel_estimates where business_id = $1", [bizA]))).rowCount).toBeGreaterThan(0);
  });
});

describe("protection des adresses privées", () => {
  it("la page publique et les informations tarifaires n'exposent ni le point de départ ni aucune coordonnée", async () => {
    await pro("update public.travel_settings set enabled = true, pricing_mode = 'per_km', per_km_cents = 50, included_km = 5, min_fee_cents = 500 where business_id = $1", [bizA]);
    const page = (await as(db, null, () => one("select public.public_booking_page($1) as p", [slugA]))).p;
    const info = (await as(db, null, () => one("select public.public_travel_info($1) as p", [slugA]))).p;
    const dump = JSON.stringify([page, info]);
    expect(dump).not.toContain("Adresse privée");
    expect(dump).not.toContain(String(BASE.lat));
    expect(info).toMatchObject({ enabled: true, pricing_mode: "per_km", per_km_cents: 50, min_fee_cents: 500 });
  });

  it("les arrêts et le point de départ ne sont lisibles qu'avec une preuve serveur récente", async () => {
    const from = at(0), to = at(24);
    const ts = epoch();
    const msg = contextMessage({ slug: slugA, fromEpoch: epoch(from), toEpoch: epoch(to), ts });
    await expect(as(db, null, () => db.query("select public.server_travel_context($1, $2, $3, $4, $5)", [slugA, from, to, ts, "f".repeat(64)]))).rejects.toThrow("MOKA_BAD_SIGNATURE");
    const oldTs = ts - 600;
    const oldSig = sign(contextMessage({ slug: slugA, fromEpoch: epoch(from), toEpoch: epoch(to), ts: oldTs }), secret);
    await expect(as(db, null, () => db.query("select public.server_travel_context($1, $2, $3, $4, $5)", [slugA, from, to, oldTs, oldSig]))).rejects.toThrow("MOKA_BAD_SIGNATURE");
    const ctx = (await as(db, null, () => one("select public.server_travel_context($1, $2, $3, $4, $5) as c", [slugA, from, to, ts, sign(msg, secret)]))).c;
    expect(ctx.start).toEqual({ lat: BASE.lat, lng: BASE.lng });
    expect(ctx.business_id).toBe(bizA);
  });

  it("une autre entreprise ne voit ni les véhicules, ni les réglages, ni les zones", async () => {
    for (const t of ["vehicles", "travel_settings", "service_areas"]) {
      expect((await as(db, ownerB, () => db.query(`select 1 from public.${t} where business_id = $1`, [bizA]))).rowCount).toBe(0);
    }
    await as(db, staffA, () => db.query("update public.travel_settings set per_km_cents = 1 where business_id = $1", [bizA]), { commit: true });
    expect((await one("select per_km_cents from public.travel_settings where business_id = $1", [bizA])).per_km_cents).toBe(50);
  });
});

describe("enchaînement des rendez-vous (agenda de la professionnelle)", () => {
  let first: string;
  it("refuse un rendez-vous dont le trajet n'est pas encore calculé", async () => {
    first = await proAppointment(at(9), "home", P1);
    await expect(proAppointment(at(10, 40), "home", P2)).rejects.toThrow("MOKA_TRAVEL_UNKNOWN");
  });

  it("refuse si le trajet depuis le rendez-vous PRÉCÉDENT ne tient pas (marge comprise)", async () => {
    await estimate(P1, P2, 14000, 1500); // 25 min → 25 × 1,2 + 5 = 35 min requises
    await expect(proAppointment(at(10, 30), "home", P2)).rejects.toThrow("MOKA_TRAVEL_TOO_SHORT");
    const ok = await proAppointment(at(10, 35), "home", P2);
    expect((await one("select travel_check from public.appointments where id = $1", [ok])).travel_check).toBe("verified");
  });

  it("vérifie aussi le trajet vers le rendez-vous SUIVANT", async () => {
    await estimate(P2, P3, 8000, 900); // 15 min → 23 min requises
    await estimate(P3, P2, 8000, 900);
    await proAppointment(at(14), "home", P3);
    await expect(proAppointment(at(12, 50), "home", P2)).rejects.toThrow("MOKA_TRAVEL_TOO_SHORT"); // fin 13h50, 10 min avant
    await proAppointment(at(12, 30), "home", P2); // fin 13h30, 30 min avant
  });

  it("un passage institut ↔ domicile compte aussi comme un trajet", async () => {
    await expect(proAppointment(at(9, 0, 2), "salon", null).then(() => proAppointment(at(10, 5, 2), "home", P1))).rejects.toThrow("MOKA_TRAVEL_UNKNOWN");
    await estimate(SALON, P1, 5000, 600); // 10 min → 17 min
    await expect(proAppointment(at(10, 10, 2), "home", P1)).rejects.toThrow("MOKA_TRAVEL_TOO_SHORT");
    await proAppointment(at(10, 20, 2), "home", P1);
  });

  it("changement de dernière minute : déplacer un rendez-vous trop près d'un autre est refusé", async () => {
    await expect(as(db, ownerA, () => db.query("select public.update_appointment($1, $2)", [first, JSON.stringify({ starts_at: at(9, 40).toISOString() })]), { commit: true })).rejects.toThrow(/MOKA_TRAVEL_TOO_SHORT|appointments_no_overlap/);
    expect((await one<{ s: Date }>("select starts_at as s from public.appointments where id = $1", [first])).s.getTime()).toBe(at(9).getTime());
  });

  it("la professionnelle peut forcer si l'adresse n'est pas localisable ; jamais une cliente", async () => {
    const forced = await proAppointment(at(9, 0, 4), "home", null, { address_line1: "Lieu-dit sans adresse" });
    expect((await one("select travel_check from public.appointments where id = $1", [forced])).travel_check).toBe("skipped_by_pro");
    const skip = await proAppointment(at(11, 0, 4), "home", P2, { skip_travel_check: true });
    expect((await one("select travel_check from public.appointments where id = $1", [skip])).travel_check).toBe("skipped_by_pro");
  });

  it("déplacements désactivés : aucun contrôle de trajet (comportement du Sprint 3)", async () => {
    await pro("update public.travel_settings set enabled = false where business_id = $1", [bizA]);
    const id = await proAppointment(at(16, 0, 5), "home", P1);
    await proAppointment(at(17, 0, 5), "home", P3);
    expect((await one("select travel_check from public.appointments where id = $1", [id])).travel_check).toBe("not_required");
    await pro("update public.travel_settings set enabled = true where business_id = $1", [bizA]);
  });
});

describe("réservation en ligne à domicile", () => {
  const C1: LatLng = { lat: 43.7, lng: 1.5 };
  it("exige une adresse vérifiée et signée par le serveur", async () => {
    await expect(book(booking())).rejects.toThrow("MOKA_ADDRESS_NOT_VERIFIED");
    await expect(book(booking({ geo: geo(C1, "31000", { tamper: true }) }))).rejects.toThrow("MOKA_ADDRESS_NOT_VERIFIED");
    await expect(book(booking({ geo: geo(C1, "31000", { expires: epoch() - 10 }) }))).rejects.toThrow("MOKA_ADDRESS_NOT_VERIFIED");
    await expect(book(booking({ geo: geo(C1, "31000", { business: bizB }) }))).rejects.toThrow("MOKA_ADDRESS_NOT_VERIFIED");
    await expect(book(booking({ geo: geo(C1, "31200") }))).rejects.toThrow("MOKA_ADDRESS_MISMATCH");
  });

  it("refuse tant que le trajet depuis le point de départ n'est pas calculé (jamais de tarif inventé)", async () => {
    await expect(book(booking({ geo: geo(C1, "31000") }))).rejects.toThrow("MOKA_TRAVEL_UNKNOWN");
  });

  it("calcule les frais en base (distance, inclus, minimum) et fige le coût du trajet", async () => {
    await estimate(BASE, C1, 12400, 1200);
    const r = await book(booking({ geo: geo(C1, "31000"), travel_fee_cents: 0, price_total_cents: 1 }));
    // 12,4 km − 5 km inclus = 7,4 km × 0,50 € = 3,70 € → minimum 5,00 €
    expect(r.travel_fee_cents).toBe(500);
    const a = await one("select price_total_cents, latitude, travel_check from public.appointments where id = $1", [r.appointment_id]);
    expect(a).toMatchObject({ price_total_cents: 5500, travel_check: "verified" });
    const items = (await db.query("select kind, unit_price_cents from public.appointment_items where appointment_id = $1 order by position", [r.appointment_id])).rows;
    expect(items).toEqual([{ kind: "service", unit_price_cents: 5000 }, { kind: "travel_fee", unit_price_cents: 500 }]);
    const t = await one("select distance_meters, fee_cents, energy_cost_cents, wear_cost_cents, time_cost_cents, other_cost_cents, economic_cost_cents, settings_version from public.appointment_travel where appointment_id = $1", [r.appointment_id]);
    // énergie 12,4 × 6,5/100 × 1,859 € = 1,4984 → 1,50 € ; usure 12,4 × 0,12 = 1,488 → 1,49 € ; temps 20 min × 20 €/h = 6,667 → 6,67 €
    expect(t).toMatchObject({ distance_meters: 12400, fee_cents: 500, energy_cost_cents: 150, wear_cost_cents: 149, time_cost_cents: 667, other_cost_cents: 0, economic_cost_cents: 966 });
    expect(t.settings_version).toBeGreaterThan(1);
    const addr = await one("select ad.latitude, ad.geocode_source from public.customer_addresses ad join public.appointments a on a.address_id = ad.id where a.id = $1", [r.appointment_id]);
    expect(addr).toMatchObject({ geocode_source: "ign" });
  });

  it("un créneau incompatible avec le trajet depuis le rendez-vous précédent est refusé", async () => {
    // rendez-vous en ligne précédent : jour+1 16h–17h en C1 ; nouvelle cliente en C2 à 17h10
    const C2: LatLng = { lat: 43.72, lng: 1.52 };
    await estimate(BASE, C2, 15000, 1300);
    await estimate(C1, C2, 3000, 600); // 10 min → 17 min requises
    await expect(book(booking({ geo: geo(C2, "31000"), starts_at: at(17, 10, 1).toISOString() }))).rejects.toThrow("MOKA_TRAVEL_TOO_SHORT");
    const ok = await book(booking({ geo: geo(C2, "31000"), starts_at: at(17, 20, 1).toISOString() }));
    expect(ok.duplicate).toBe(false);
  });

  it("zones : exclusion, jour d'intervention, minimum de commande, supplément", async () => {
    const C3: LatLng = { lat: 43.5, lng: 1.3 };
    await estimate(BASE, C3, 20000, 1500);
    await pro("insert into public.service_areas (business_id, name, kind, postcodes, excluded) values ($1, 'Exclue', 'postcodes', '{31999}', true)", [bizA]);
    await expect(book(booking({ geo: geo(C3, "31999"), postal_code: "31999", starts_at: at(9, 0, 6).toISOString() }))).rejects.toThrow("MOKA_OUT_OF_AREA");
    const weekday = (await one<{ d: number }>("select extract(isodow from $1::timestamptz at time zone 'Europe/Paris')::int as d", [at(9, 0, 6)])).d;
    const otherDay = (weekday % 7) + 1;
    await pro("insert into public.service_areas (business_id, name, kind, max_km, surcharge_cents, min_order_cents, weekdays, position) values ($1, 'Sud', 'radius', 25, 200, 3000, $2, 1)", [bizA, `{${otherDay}}`]);
    await expect(book(booking({ geo: geo(C3, "31100"), postal_code: "31100", starts_at: at(9, 0, 6).toISOString() }))).rejects.toThrow("MOKA_AREA_WRONG_DAY");
    await pro("update public.service_areas set weekdays = null where name = 'Sud' and business_id = $1", [bizA]);
    await expect(book(booking({ geo: geo(C3, "31100"), postal_code: "31100", service_id: svcCheap, starts_at: at(9, 0, 6).toISOString() }))).rejects.toThrow("MOKA_AREA_MINIMUM");
    const r = await book(booking({ geo: geo(C3, "31100"), postal_code: "31100", starts_at: at(9, 0, 6).toISOString() }));
    // 20 km − 5 = 15 km × 0,50 € = 7,50 € + supplément zone 2,00 €
    expect(r.travel_fee_cents).toBe(950);
    expect((await one("select zone_name from public.appointment_travel where appointment_id = $1", [r.appointment_id])).zone_name).toBe("Sud");
    // Hors de toute zone incluse
    const C4: LatLng = { lat: 44.2, lng: 1.9 };
    await estimate(BASE, C4, 60000, 3600);
    await expect(book(booking({ geo: geo(C4, "46000"), postal_code: "46000", starts_at: at(14, 0, 6).toISOString() }))).rejects.toThrow("MOKA_OUT_OF_AREA");
  });

  it("déplacement offert au-delà d'un montant de prestation", async () => {
    const C5: LatLng = { lat: 43.55, lng: 1.45 };
    await estimate(BASE, C5, 10000, 900);
    await pro("update public.travel_settings set pricing_mode = 'free_above', free_above_cents = 4000 where business_id = $1", [bizA]);
    const r = await book(booking({ geo: geo(C5, "31100"), postal_code: "31100", starts_at: at(11, 0, 7).toISOString() }));
    expect(r.travel_fee_cents).toBe(0);
    await pro("update public.travel_settings set pricing_mode = 'per_km' where business_id = $1", [bizA]);
  });

  it("en institut, aucune adresse ni aucun frais de déplacement", async () => {
    const r = await book(booking({ place: "salon", address_line1: "", postal_code: "", city: "", starts_at: at(8, 0, 8).toISOString() }));
    expect(r.travel_fee_cents).toBe(0);
  });
});

describe("application d'une tournée optimisée", () => {
  it("échange deux rendez-vous en une seule fois, revérifie les trajets, et refuse une tournée périmée", async () => {
    const Q1: LatLng = { lat: 43.66, lng: 1.41 };
    const Q2: LatLng = { lat: 43.67, lng: 1.43 };
    await estimate(Q1, Q2, 2000, 300);
    await estimate(Q2, Q1, 2000, 300);
    const a = await proAppointment(at(9, 0, 10), "home", Q1);
    const b = await proAppointment(at(10, 30, 10), "home", Q2);
    const plan = await as(
      db,
      ownerA,
      async () => {
        const id = (await one<{ id: string }>("insert into public.route_plans (business_id, day) values ($1, current_date) returning id", [bizA])).id;
        await db.query(
          "insert into public.route_plan_stops (business_id, route_plan_id, appointment_id, position, current_starts_at, proposed_starts_at) values ($1, $2, $3, 1, $4, $5), ($1, $2, $6, 2, $5, $4)",
          [bizA, id, b, at(9, 0, 10), at(10, 30, 10), a],
        );
        return id;
      },
      { commit: true },
    );
    // b n'est pas encore à 9h : le plan ne correspond pas à l'agenda (current de b = 9h)
    await expect(as(db, ownerA, () => db.query("select public.apply_route_plan($1)", [plan]))).rejects.toThrow("MOKA_PLAN_OUTDATED");
    const good = await as(
      db,
      ownerA,
      async () => {
        const id = (await one<{ id: string }>("insert into public.route_plans (business_id, day) values ($1, current_date) returning id", [bizA])).id;
        await db.query(
          "insert into public.route_plan_stops (business_id, route_plan_id, appointment_id, position, current_starts_at, proposed_starts_at) values ($1, $2, $3, 1, $4, $5), ($1, $2, $6, 2, $5, $4)",
          [bizA, id, b, at(10, 30, 10), at(9, 0, 10), a],
        );
        return id;
      },
      { commit: true },
    );
    expect((await as(db, ownerA, () => one("select public.apply_route_plan($1) as n", [good]), { commit: true })).n).toBe(2);
    const rows = (await db.query("select id, starts_at, travel_check from public.appointments where id = any($1)", [[a, b]])).rows;
    expect(rows.find((r) => r.id === b).starts_at.getTime()).toBe(at(9, 0, 10).getTime());
    expect(rows.every((r) => r.travel_check === "verified")).toBe(true);
    expect((await one("select status from public.route_plans where id = $1", [good])).status).toBe("applied");
    await expect(as(db, ownerB, () => db.query("select public.apply_route_plan($1)", [good]))).rejects.toThrow(/MOKA_NOT_FOUND|MOKA_PLAN_CLOSED/);
  });

  it("refuse une tournée dont un trajet ne tient pas (tout est annulé)", async () => {
    const Q3: LatLng = { lat: 43.68, lng: 1.44 };
    const Q4: LatLng = { lat: 43.69, lng: 1.46 };
    await estimate(Q3, Q4, 30000, 2400);
    await estimate(Q4, Q3, 30000, 2400);
    const a = await proAppointment(at(9, 0, 11), "home", Q3);
    const b = await proAppointment(at(11, 0, 11), "home", Q4);
    const plan = await as(
      db,
      ownerA,
      async () => {
        const id = (await one<{ id: string }>("insert into public.route_plans (business_id, day) values ($1, current_date) returning id", [bizA])).id;
        await db.query(
          "insert into public.route_plan_stops (business_id, route_plan_id, appointment_id, position, current_starts_at, proposed_starts_at) values ($1, $2, $3, 1, $4, $5)",
          [bizA, id, b, at(11, 0, 11), at(10, 10, 11)],
        );
        return id;
      },
      { commit: true },
    );
    await expect(as(db, ownerA, () => db.query("select public.apply_route_plan($1)", [plan]), { commit: true })).rejects.toThrow("MOKA_TRAVEL_TOO_SHORT");
    expect((await one<{ s: Date }>("select starts_at as s from public.appointments where id = $1", [b])).s.getTime()).toBe(at(11, 0, 11).getTime());
    void a;
  });
});
