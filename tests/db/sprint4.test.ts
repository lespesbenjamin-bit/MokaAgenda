/**
 * Sprint 4 — réservation en ligne publique.
 * La cliente agit avec le rôle `anon` (aucun compte, aucune clé service_role) :
 * uniquement via les fonctions public_*. La professionnelle agit avec le rôle
 * `authenticated` soumis à la RLS.
 * Les dates sont calculées à partir de maintenant (horaires 7 j/7).
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { as, connect, createUser, TEST_DATABASE_URL } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let db: Client;
let ownerA: string, ownerB: string;
let bizA: string, bizB: string;
let slugA: string, slugB: string;
let svc: string, svcInactive: string, svcDeposit: string, svcOffline: string, svcSalonOnly: string, svcB: string;
let dayStart: Date; // J+3 à 00:00 Europe/Paris

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;
const at = (hour: number, minute = 0, dayOffset = 0) => new Date(dayStart.getTime() + ((dayOffset * 24 + hour) * 60 + minute) * 60_000);

const newToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
};

function bookingPayload(over: Record<string, unknown> = {}) {
  return {
    slug: slugA,
    service_id: svc,
    place: "salon",
    starts_at: at(10).toISOString(),
    first_name: "Nina",
    last_name: "Martin",
    email: `nina.${randomUUID().slice(0, 8)}@exemple.fr`,
    phone: `06 ${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    accept_terms: true,
    idempotency_key: randomUUID(),
    token_hash: newToken().hash,
    ...over,
  };
}

type BookingResult = { appointment_id: string; duplicate: boolean; notifications: { id: string; kind: string; recipient: string }[] };
const book = (p: Record<string, unknown>, client: Client = db) =>
  as(client, null, async () => (await client.query("select public.public_create_booking($1) as r", [JSON.stringify(p)])).rows[0].r as BookingResult, { commit: true });

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(code);
}

beforeAll(async () => {
  db = await connect();
  ownerA = await createUser(db, "s4-a@example.fr");
  ownerB = await createUser(db, "s4-b@example.fr");
  bizA = await as(db, ownerA, async () => (await one<{ id: string }>("select public.create_business('Institut Élodie', null, null, 'pro-a@example.fr') as id")).id, { commit: true });
  bizB = await as(db, ownerB, async () => (await one<{ id: string }>("select public.create_business('Beauté B', null, null, 'pro-b@example.fr') as id")).id, { commit: true });
  slugA = (await one<{ slug: string }>("select slug from public.businesses where id = $1", [bizA])).slug;
  slugB = (await one<{ slug: string }>("select slug from public.businesses where id = $1", [bizB])).slug;
  dayStart = (await one<{ d: Date }>("select ((date_trunc('day', now() at time zone 'Europe/Paris') + interval '3 days') at time zone 'Europe/Paris') as d")).d;

  for (const [owner, biz] of [[ownerA, bizA], [ownerB, bizB]] as const) {
    await as(
      db,
      owner,
      async () => {
        await db.query("update public.business_settings set booking_enabled = true where business_id = $1", [biz]);
        const rules = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_minute: 480, end_minute: 1200, place: null }));
        await db.query("select public.replace_availability_rules($1, $2)", [biz, JSON.stringify(rules)]);
      },
      { commit: true },
    );
  }

  await as(
    db,
    ownerA,
    async () => {
      await db.query("insert into public.locations (business_id, kind, address_line1, postal_code, city) values ($1, 'salon', '5 rue du Salon', '31000', 'Toulouse'), ($1, 'travel_base', '9 rue Privée', '31770', 'Colomiers')", [bizA]);
      const mk = async (name: string, extra = "", extraVals = "") =>
        (await one<{ id: string }>(`insert into public.services (business_id, name, duration_minutes, buffer_minutes, base_price_cents, extra_fee_cents${extra}) values ($1, $2, 60, 15, 5000, 500${extraVals}) returning id`, [bizA, name])).id;
      svc = await mk("Soin éclat");
      svcInactive = await mk("Ancien soin", ", is_active", ", false");
      svcDeposit = await mk("Mariée", ", deposit_type, deposit_value", ", 'percentage', 30");
      svcOffline = await mk("Sur devis", ", online_bookable", ", false");
      svcSalonOnly = await mk("Cabine");
      for (const s of [svc, svcInactive, svcDeposit, svcOffline]) {
        await db.query("insert into public.service_locations (business_id, service_id, place, price_cents) values ($1, $2, 'salon', null), ($1, $2, 'home', 7000)", [bizA, s]);
      }
      await db.query("insert into public.service_locations (business_id, service_id, place) values ($1, $2, 'salon')", [bizA, svcSalonOnly]);
      await db.query("insert into public.service_costs (business_id, service_id, kind, amount_cents) values ($1, $2, 'consumables', 300)", [bizA, svc]);
    },
    { commit: true },
  );
  await as(
    db,
    ownerB,
    async () => {
      svcB = (await one<{ id: string }>("insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'Soin B', 30, 3000) returning id", [bizB])).id;
      await db.query("insert into public.service_locations (business_id, service_id, place) values ($1, $2, 'salon')", [bizB, svcB]);
    },
    { commit: true },
  );
});

afterAll(async () => db?.end());

describe("adresse publique (slug)", () => {
  it("génère un identifiant d'URL lisible et unique", () => {
    expect(slugA).toBe("institut-elodie");
    expect(slugB).toBe("beaute-b");
  });

  it("la professionnelle peut le modifier, mais pas prendre celui d'une autre ni un format invalide", async () => {
    await as(db, ownerB, () => db.query("update public.businesses set slug = 'beaute-b-toulouse' where id = $1", [bizB]), { commit: true });
    slugB = "beaute-b-toulouse";
    await expect(as(db, ownerB, () => db.query("update public.businesses set slug = $2 where id = $1", [bizB, slugA]))).rejects.toThrow(/businesses_slug_uidx/);
    await expect(as(db, ownerB, () => db.query("update public.businesses set slug = 'Pas Valide!' where id = $1", [bizB]))).rejects.toThrow(/businesses_slug_format/);
  });
});

describe("accès anonyme", () => {
  it("aucune table n'est lisible directement sans compte", async () => {
    for (const table of ["appointments", "customers", "customer_addresses", "notifications", "business_settings", "services", "businesses", "booking_events"]) {
      await expect(as(db, null, () => db.query(`select 1 from public.${table} limit 1`))).rejects.toThrow(/permission denied/);
    }
  });

  it("la page publique n'expose que les prestations actives et réservables, sans adresse de départ", async () => {
    const page = (await as(db, null, () => one<{ p: Json }>("select public.public_booking_page($1) as p", [slugA]))).p;
    const names = page.services.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(["Cabine", "Mariée", "Soin éclat"]);
    const soin = page.services.find((s: { name: string }) => s.name === "Soin éclat");
    expect(soin.places).toEqual([
      { place: "salon", price_cents: 5500 },
      { place: "home", price_cents: 7500 },
    ]);
    expect(page.salon.city).toBe("Toulouse");
    expect(JSON.stringify(page)).not.toContain("Colomiers");
    expect(JSON.stringify(page)).not.toContain("pro-a@example.fr");
  });

  it("une page désactivée ou inconnue ne renvoie rien", async () => {
    await as(db, ownerB, () => db.query("update public.business_settings set booking_enabled = false where business_id = $1", [bizB]), { commit: true });
    expect((await as(db, null, () => one("select public.public_booking_page($1) as p", [slugB]))).p).toBeNull();
    await expectError(book(bookingPayload({ slug: slugB, service_id: svcB })), "MOKA_BOOKING_UNAVAILABLE");
    await as(db, ownerB, () => db.query("update public.business_settings set booking_enabled = true where business_id = $1", [bizB]), { commit: true });
    expect((await as(db, null, () => one("select public.public_booking_page('inconnue') as p"))).p).toBeNull();
  });
});

describe("réservation en institut", () => {
  let result: BookingResult;
  let email: string;
  it("crée un rendez-vous confirmé, avec le prix lu dans le catalogue (jamais envoyé par le navigateur)", async () => {
    const p = bookingPayload({ starts_at: at(9).toISOString(), price_total_cents: 1, unit_price_cents: 1, comment: "Peau sensible" });
    email = p.email;
    result = await book(p);
    expect(result.duplicate).toBe(false);
    const a = await one(
      "select status, source, place, price_total_cents, balance_due_cents, deposit_amount_cents, customer_comment, conditions_snapshot ->> 'cancellation_notice_hours' as notice from public.appointments where id = $1",
      [result.appointment_id],
    );
    expect(a).toEqual({ status: "confirmed", source: "online", place: "salon", price_total_cents: 5500, balance_due_cents: 5500, deposit_amount_cents: 0, customer_comment: "Peau sensible", notice: "24" });
    const item = await one("select service_name, unit_price_cents, consumables_cents, deposit_type from public.appointment_items where appointment_id = $1", [result.appointment_id]);
    expect(item).toEqual({ service_name: "Soin éclat", unit_price_cents: 5500, consumables_cents: 300, deposit_type: "none" });
  });

  it("crée la fiche cliente (origine « réservation ») et l'historique", async () => {
    const c = await one("select c.first_name, c.last_name, c.source, c.business_id from public.customers c join public.appointments a on a.customer_id = c.id where a.id = $1", [result.appointment_id]);
    expect(c).toEqual({ first_name: "Nina", last_name: "Martin", source: "booking", business_id: bizA });
    const ev = await one("select event_type, actor_id from public.booking_events where appointment_id = $1", [result.appointment_id]);
    expect(ev).toEqual({ event_type: "created", actor_id: null });
  });

  it("prépare un email pour la cliente et un pour la professionnelle", async () => {
    const rows = (await db.query("select kind, recipient, status from public.notifications where appointment_id = $1 order by kind", [result.appointment_id])).rows;
    expect(rows).toEqual([
      { kind: "booking_confirmed_customer", recipient: email, status: "pending" },
      { kind: "booking_new_pro", recipient: "pro-a@example.fr", status: "pending" },
    ]);
    expect(result.notifications.map((n) => n.kind).sort()).toEqual(["booking_confirmed_customer", "booking_new_pro"]);
  });

  it("le rendez-vous est visible dans l'agenda de la professionnelle, pas dans celui d'une autre", async () => {
    expect((await as(db, ownerA, () => db.query("select id from public.appointments where id = $1", [result.appointment_id]))).rowCount).toBe(1);
    expect((await as(db, ownerB, () => db.query("select id from public.appointments where id = $1", [result.appointment_id]))).rowCount).toBe(0);
    expect((await as(db, ownerB, () => db.query("select id from public.notifications where appointment_id = $1", [result.appointment_id]))).rowCount).toBe(0);
  });

  it("le créneau n'est plus proposé : il apparaît occupé, sans aucune information sur le rendez-vous", async () => {
    const av = (await as(db, null, () => one<{ a: Json }>("select public.public_availability($1, $2, $3) as a", [slugA, at(0), at(24)]))).a;
    expect(av.busy).toHaveLength(1);
    expect(Object.keys(av.busy[0]).sort()).toEqual(["end", "start"]);
    expect(new Date(av.busy[0].end).getTime()).toBe(at(10, 15).getTime()); // 60 min + 15 min de tampon
    expect(av.rules).toHaveLength(7);
  });

  it("refuse un second rendez-vous sur le même créneau ou pendant le temps tampon", async () => {
    await expectError(book(bookingPayload({ starts_at: at(9, 30).toISOString() })), "MOKA_SLOT_TAKEN");
    await expectError(book(bookingPayload({ starts_at: at(10).toISOString() })), "MOKA_SLOT_TAKEN");
    const ok = await book(bookingPayload({ starts_at: at(10, 15).toISOString() }));
    expect(ok.duplicate).toBe(false);
  });

  it("une double soumission (même clé) ne crée qu'un seul rendez-vous", async () => {
    const p = bookingPayload({ starts_at: at(14).toISOString() });
    const first = await book(p);
    const second = await book(p);
    expect(second).toMatchObject({ appointment_id: first.appointment_id, duplicate: true });
    expect((await one<{ n: string }>("select count(*) as n from public.appointments where idempotency_key = $1", [p.idempotency_key])).n).toBe("1");
  });
});

describe("contrôles", () => {
  it("prestations inactives, sur devis, avec acompte ou lieu non proposé : refusées", async () => {
    await expectError(book(bookingPayload({ service_id: svcInactive, starts_at: at(16).toISOString() })), "MOKA_SERVICE_UNAVAILABLE");
    await expectError(book(bookingPayload({ service_id: svcOffline, starts_at: at(16).toISOString() })), "MOKA_SERVICE_UNAVAILABLE");
    await expectError(book(bookingPayload({ service_id: svcDeposit, starts_at: at(16).toISOString() })), "MOKA_DEPOSIT_REQUIRED");
    await expectError(book(bookingPayload({ service_id: svcSalonOnly, place: "home", starts_at: at(16).toISOString(), address_line1: "1 rue", postal_code: "31000", city: "Toulouse" })), "MOKA_PLACE_UNAVAILABLE");
    await expectError(book(bookingPayload({ service_id: svcB, starts_at: at(16).toISOString() })), "MOKA_SERVICE_UNAVAILABLE");
  });

  it("hors horaires, période bloquée, trop tôt ou trop loin : refusés", async () => {
    await expectError(book(bookingPayload({ starts_at: at(6).toISOString() })), "MOKA_OUTSIDE_HOURS");
    await expectError(book(bookingPayload({ starts_at: at(19, 30).toISOString() })), "MOKA_OUTSIDE_HOURS");
    await as(db, ownerA, () => db.query("insert into public.availability_exceptions (business_id, kind, label, starts_at, ends_at) values ($1, 'vacation', 'Motif privé', $2, $3)", [bizA, at(0, 0, 1), at(24, 0, 1)]), { commit: true });
    await expectError(book(bookingPayload({ starts_at: at(10, 0, 1).toISOString() })), "MOKA_BLOCKED_PERIOD");
    const av = (await as(db, null, () => one<{ a: Json }>("select public.public_availability($1, $2, $3) as a", [slugA, at(0, 0, 1), at(24, 0, 1)]))).a;
    expect(JSON.stringify(av.blocks)).not.toContain("Motif");
    await expectError(book(bookingPayload({ starts_at: new Date(Date.now() - 3600_000).toISOString() })), "MOKA_TOO_LATE");
    await expectError(book(bookingPayload({ starts_at: at(10, 0, 90).toISOString() })), "MOKA_TOO_FAR");
    await expectError(book(bookingPayload({ starts_at: at(11, 7).toISOString() })), "MOKA_INVALID_INPUT");
  });

  it("coordonnées et conditions : validation stricte", async () => {
    const s = at(17).toISOString();
    await expectError(book(bookingPayload({ starts_at: s, accept_terms: false })), "MOKA_TERMS_REQUIRED");
    await expectError(book(bookingPayload({ starts_at: s, email: "pas-un-email" })), "MOKA_INVALID_EMAIL");
    await expectError(book(bookingPayload({ starts_at: s, phone: "12" })), "MOKA_INVALID_PHONE");
    await expectError(book(bookingPayload({ starts_at: s, first_name: " " })), "MOKA_INVALID_NAME");
    await expectError(book(bookingPayload({ starts_at: s, token_hash: "court" })), "MOKA_INVALID_INPUT");
    await expectError(book(bookingPayload({ starts_at: s, place: "garage" })), "MOKA_INVALID_INPUT");
  });
});

describe("réservation à domicile", () => {
  it("refuse une adresse incomplète ou un code postal invalide", async () => {
    const base = { place: "home", starts_at: at(16).toISOString() };
    await expectError(book(bookingPayload({ ...base })), "MOKA_INVALID_ADDRESS");
    await expectError(book(bookingPayload({ ...base, address_line1: "3 allée des Pins", postal_code: "310", city: "Toulouse" })), "MOKA_INVALID_ADDRESS");
    await expectError(book(bookingPayload({ ...base, address_line1: "3 allée des Pins", postal_code: "31000", city: "" })), "MOKA_INVALID_ADDRESS");
  });

  it("enregistre l'adresse sur le rendez-vous et dans la fiche, au tarif domicile", async () => {
    const r = await book(bookingPayload({ place: "home", starts_at: at(16).toISOString(), address_line1: "3 allée des Pins", postal_code: "31000", city: "Toulouse" }));
    const a = await one("select address_line1, city, price_total_cents, address_id is not null as linked from public.appointments where id = $1", [r.appointment_id]);
    expect(a).toEqual({ address_line1: "3 allée des Pins", city: "Toulouse", price_total_cents: 7500, linked: true });
    const ad = await one("select ad.line1, ad.is_primary from public.customer_addresses ad join public.appointments a on a.address_id = ad.id where a.id = $1", [r.appointment_id]);
    expect(ad).toEqual({ line1: "3 allée des Pins", is_primary: true });
  });
});

describe("fiches clientes sans doublon", () => {
  let existing: string;
  beforeAll(async () => {
    existing = await as(
      db,
      ownerA,
      async () => (await one<{ id: string }>("insert into public.customers (business_id, first_name, last_name, email, phone, notes) values ($1, 'Camille', 'Durand', 'Camille.D@Exemple.fr', null, 'Allergie au latex') returning id", [bizA])).id,
      { commit: true },
    );
  });

  it("rattache à la fiche existante (même email) sans écraser le nom ni les notes, et complète le téléphone", async () => {
    const r = await book(bookingPayload({ starts_at: at(11, 30).toISOString(), first_name: "Cam", last_name: "Autre", email: "camille.d@exemple.fr", phone: "+33 6 99 88 77 66" }));
    const a = await one<{ customer_id: string }>("select customer_id from public.appointments where id = $1", [r.appointment_id]);
    expect(a.customer_id).toBe(existing);
    const c = await one("select first_name, last_name, notes, phone_normalized from public.customers where id = $1", [existing]);
    expect(c).toEqual({ first_name: "Camille", last_name: "Durand", notes: "Allergie au latex", phone_normalized: "0699887766" });
  });

  it("retrouve aussi la fiche par le téléphone (format international)", async () => {
    const r = await book(bookingPayload({ starts_at: at(12, 45).toISOString(), email: "autre.adresse@exemple.fr", phone: "0033699887766" }));
    expect((await one<{ customer_id: string }>("select customer_id from public.appointments where id = $1", [r.appointment_id])).customer_id).toBe(existing);
    expect((await one<{ n: string }>("select count(*) as n from public.customers where business_id = $1 and phone_normalized = '0699887766'", [bizA])).n).toBe("1");
  });

  it("une même cliente dans une autre entreprise reste une fiche distincte", async () => {
    const r = await book(bookingPayload({ slug: slugB, service_id: svcB, starts_at: at(9).toISOString(), email: "camille.d@exemple.fr" }));
    const c = await one<{ business_id: string; id: string }>("select c.business_id, c.id from public.customers c join public.appointments a on a.customer_id = c.id where a.id = $1", [r.appointment_id]);
    expect(c.business_id).toBe(bizB);
    expect(c.id).not.toBe(existing);
  });

  it("plafonne les réservations d'un même contact (anti-abus) : 3 par 24 h", async () => {
    await book(bookingPayload({ starts_at: at(17, 15).toISOString(), email: "camille.d@exemple.fr" }));
    await expectError(book(bookingPayload({ starts_at: at(18, 45).toISOString(), email: "camille.d@exemple.fr" })), "MOKA_RATE_LIMITED");
  });
});

describe("réservations simultanées", () => {
  it("deux clientes sur le même créneau au même instant : une seule réussit", async () => {
    const other = new Client({ connectionString: TEST_DATABASE_URL });
    await other.connect();
    try {
      const results = await Promise.allSettled([
        book(bookingPayload({ starts_at: at(9, 0, 2).toISOString() }), db),
        book(bookingPayload({ starts_at: at(9, 30, 2).toISOString() }), other),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(String(failed.reason)).toContain("MOKA_SLOT_TAKEN");
    } finally {
      await other.end();
    }
  });
});

describe("lien sécurisé : consultation, annulation, déplacement", () => {
  let token: { token: string; hash: string };
  let id: string;
  beforeAll(async () => {
    token = newToken();
    id = (await book(bookingPayload({ starts_at: at(15, 0, 2).toISOString(), token_hash: token.hash }))).appointment_id;
  });

  it("la cliente retrouve son rendez-vous avec le lien ; un mauvais lien ne renvoie rien", async () => {
    const b = (await as(db, null, () => one<{ b: Json }>("select public.public_get_booking($1) as b", [token.hash]))).b;
    expect(b).toMatchObject({ status: "confirmed", place: "salon", price_total_cents: 5500, business: { slug: slugA }, salon: { city: "Toulouse" } });
    expect(b.items[0].name).toBe("Soin éclat");
    expect((await as(db, null, () => one("select public.public_get_booking($1) as b", [newToken().hash]))).b).toBeNull();
  });

  it("déplace le rendez-vous vers un créneau libre et prévient les deux parties", async () => {
    const r = (await as(db, null, () => one<{ r: { notifications: { id: string; kind: string; recipient: string }[] } }>("select public.public_reschedule_booking($1, $2) as r", [token.hash, at(17, 0, 2)]), { commit: true })).r;
    expect(r.notifications).toHaveLength(2);
    expect((await one<{ s: Date }>("select starts_at as s from public.appointments where id = $1", [id])).s.getTime()).toBe(at(17, 0, 2).getTime());
    expect((await one("select event_type from public.booking_events where appointment_id = $1 order by created_at desc limit 1", [id])).event_type).toBe("rescheduled");
  });

  it("refuse un déplacement sur un créneau occupé", async () => {
    await expectError(as(db, null, () => db.query("select public.public_reschedule_booking($1, $2)", [token.hash, at(9, 15, 2)])), "MOKA_SLOT_TAKEN");
  });

  it("enregistre le résultat d'envoi d'un email uniquement avec le bon lien", async () => {
    const nid = (await one<{ id: string }>("select id from public.notifications where appointment_id = $1 and kind = 'booking_rescheduled_customer'", [id])).id;
    await as(db, null, () => db.query("select public.public_record_notification($1, $2, 'sent', 'test', 'msg-1')", [newToken().hash, nid]), { commit: true });
    expect((await one("select status from public.notifications where id = $1", [nid])).status).toBe("pending");
    await as(db, null, () => db.query("select public.public_record_notification($1, $2, 'sent', 'test', 'msg-1')", [token.hash, nid]), { commit: true });
    expect(await one("select status, provider_message_id from public.notifications where id = $1", [nid])).toEqual({ status: "sent", provider_message_id: "msg-1" });
  });

  it("annule, libère le créneau et refuse toute action ultérieure", async () => {
    await expectError(as(db, null, () => db.query("select public.public_cancel_booking($1)", [newToken().hash])), "MOKA_NOT_FOUND");
    await as(db, null, () => db.query("select public.public_cancel_booking($1, 'Empêchement')", [token.hash]), { commit: true });
    expect(await one("select status, cancel_reason from public.appointments where id = $1", [id])).toEqual({ status: "cancelled", cancel_reason: "Empêchement" });
    expect((await db.query("select kind from public.notifications where appointment_id = $1 and kind like 'booking_cancelled%'", [id])).rowCount).toBe(2);
    await expectError(as(db, null, () => db.query("select public.public_cancel_booking($1)", [token.hash])), "MOKA_APPOINTMENT_CLOSED");
    const free = await book(bookingPayload({ starts_at: at(17, 0, 2).toISOString() }));
    expect(free.duplicate).toBe(false);
  });

  it("respecte le délai d'annulation et les règles fixées au moment de la réservation", async () => {
    await as(db, ownerA, () => db.query("update public.business_settings set cancellation_notice_hours = 720 where business_id = $1", [bizA]), { commit: true });
    const late = newToken();
    await book(bookingPayload({ starts_at: at(10, 0, 5).toISOString(), token_hash: late.hash }));
    await as(db, ownerA, () => db.query("update public.business_settings set cancellation_notice_hours = 24, customer_can_reschedule = false where business_id = $1", [bizA]), { commit: true });
    // Délai figé à 720 h lors de la réservation : trop tard pour annuler
    await expectError(as(db, null, () => db.query("select public.public_cancel_booking($1)", [late.hash])), "MOKA_CHANGE_TOO_LATE");
    // Réservation faite après désactivation du déplacement : refusé
    const noMove = newToken();
    await book(bookingPayload({ starts_at: at(12, 0, 5).toISOString(), token_hash: noMove.hash }));
    await expectError(as(db, null, () => db.query("select public.public_reschedule_booking($1, $2)", [noMove.hash, at(15, 0, 5)])), "MOKA_CHANGE_NOT_ALLOWED");
    await as(db, ownerA, () => db.query("update public.business_settings set customer_can_reschedule = true where business_id = $1", [bizA]), { commit: true });
  });

  it("la professionnelle ne peut pas lire les notifications d'une autre entreprise ni en créer pour elle", async () => {
    await expect(
      as(db, ownerB, () => db.query("insert into public.notifications (business_id, kind, recipient) values ($1, 'booking_new_pro', 'x@y.fr')", [bizA])),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuse une plage de disponibilités trop large", async () => {
    await expectError(as(db, null, () => db.query("select public.public_availability($1, $2, $3)", [slugA, at(0), at(0, 0, 60)])), "MOKA_INVALID_RANGE");
  });
});
