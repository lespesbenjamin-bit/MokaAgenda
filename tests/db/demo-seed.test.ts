/**
 * Les données démo respectent toutes les contraintes et la RLS : elles sont
 * réellement insérées dans PostgreSQL avec le rôle `authenticated`
 * (la réinitialisation réelle utilise les mêmes lignes).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, createUser } from "./helpers";
import { DEMO_TABLE_ORDER, buildDemoRows, rowsByTable } from "@/server/demo/seed";

let db: Client;
let owner: string;
let biz: string;

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db, "demo-seed@example.fr");
  biz = await as(db, owner, async () => (await db.query("select public.create_business('Moka Beauty Studio') as id")).rows[0].id, { commit: true });
});
afterAll(async () => db?.end());

describe("données de démonstration", () => {
  it("s'insèrent sans erreur dans toutes les tables (contraintes + RLS)", async () => {
    const tables = rowsByTable(buildDemoRows(biz));
    await as(
      db,
      owner,
      async () => {
        for (const table of DEMO_TABLE_ORDER) {
          for (const row of tables[table]) {
            const cols = Object.keys(row);
            await db.query(
              `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
              cols.map((c) => row[c]),
            );
          }
        }
      },
      { commit: true },
    );
    const count = async (t: string) => Number((await db.query(`select count(*) from public.${t} where business_id = $1`, [biz])).rows[0].count);
    expect(await count("service_categories")).toBe(6);
    expect(await count("services")).toBe(20);
    expect(await count("customers")).toBe(25);
    expect(await count("customer_addresses")).toBeGreaterThan(25);
  });

  it("chaque cliente a exactement une adresse principale", async () => {
    const { rows } = await db.query(
      "select c.id, count(a.*) filter (where a.is_primary) as p from public.customers c left join public.customer_addresses a on a.customer_id = c.id where c.business_id = $1 group by c.id",
      [biz],
    );
    expect(rows.every((r) => Number(r.p) === 1)).toBe(true);
  });

  it("propose des prestations à domicile, en institut et les deux", async () => {
    const { rows } = await db.query(
      "select s.id, array_agg(l.place order by l.place) as places from public.services s join public.service_locations l on l.service_id = s.id where s.business_id = $1 group by s.id",
      [biz],
    );
    const kinds = new Set(rows.map((r) => String(r.places)));
    expect(kinds).toEqual(new Set(["{salon}", "{home}", "{home,salon}"]));
  });

  it("n'utilise que des emails non routables et aucune coordonnée GPS inventée", async () => {
    const emails = (await db.query("select email from public.customers where business_id = $1 and email is not null", [biz])).rows;
    expect(emails.every((r) => r.email.endsWith("@exemple.demo"))).toBe(true);
    const gps = await db.query("select 1 from public.customer_addresses where business_id = $1 and latitude is not null", [biz]);
    expect(gps.rowCount).toBe(0);
  });
});

describe("agenda de démonstration", () => {
  it("des rendez-vous cohérents avec les horaires, sans chevauchement, passés et à venir", async () => {
    const { rows } = await db.query(
      "select place, status, starts_at < now() as past from public.appointments where business_id = $1",
      [biz],
    );
    expect(rows.length).toBeGreaterThan(20);
    expect(new Set(rows.map((r) => r.place))).toEqual(new Set(["home", "salon"]));
    expect(rows.some((r) => r.past && r.status === "completed")).toBe(true);
    expect(rows.some((r) => !r.past && (r.status === "confirmed" || r.status === "pending"))).toBe(true);
    expect(rows.filter((r) => !r.past).every((r) => r.status === "confirmed" || r.status === "pending")).toBe(true);
  });

  it("chaque rendez-vous a sa prestation figée et une adresse s'il est à domicile", async () => {
    const missing = await db.query(
      "select a.id from public.appointments a left join public.appointment_items i on i.appointment_id = a.id where a.business_id = $1 and i.id is null",
      [biz],
    );
    expect(missing.rowCount).toBe(0);
    const homeWithoutAddress = await db.query("select 1 from public.appointments where business_id = $1 and place = 'home' and address_line1 is null", [biz]);
    expect(homeWithoutAddress.rowCount).toBe(0);
  });

  it("un rendez-vous de démonstration peut être déplacé et annulé (comme en vrai)", async () => {
    const next = (
      await db.query("select id from public.appointments where business_id = $1 and status = 'confirmed' and starts_at > now() order by starts_at limit 1", [biz])
    ).rows[0];
    await as(db, owner, () => db.query("update public.appointments set status = 'cancelled' where id = $1", [next.id]), { commit: true });
    expect((await db.query("select status from public.appointments where id = $1", [next.id])).rows[0].status).toBe("cancelled");
  });
});

describe("réservation en ligne de démonstration", () => {
  it("la page publique fictive est ouverte et ne montre que les prestations réservables", async () => {
    const { demoFixtures: f } = await import("@/server/demo/fixtures");
    await as(
      db,
      owner,
      async () => {
        await db.query("update public.businesses set slug = $2 where id = $1", [biz, f.business.slug]);
        const s = f.settings as Record<string, unknown>;
        const cols = Object.keys(s).filter((k) => k !== "timezone" && k !== "default_appointment_minutes" && k !== "service_radius_km");
        await db.query(
          `update public.business_settings set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where business_id = $1`,
          [biz, ...cols.map((c) => s[c])],
        );
      },
      { commit: true },
    );
    const page = (await as(db, null, () => db.query("select public.public_booking_page($1) as p", [f.business.slug]))).rows[0].p;
    expect(page.business.name).toBe("Moka Beauty Studio");
    expect(page.has_hours).toBe(true);
    expect(page.services.length).toBe(f.services.filter((s) => s.online_bookable).length);
  });

  it("les rendez-vous « pris en ligne » fictifs n'exigent aucun acompte", async () => {
    const { rows } = await db.query("select deposit_amount_cents from public.appointments where business_id = $1 and source = 'online'", [biz]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.deposit_amount_cents === 0)).toBe(true);
  });

  it("une réservation test sans compte arrive dans l'agenda de démonstration", async () => {
    const { demoFixtures: f } = await import("@/server/demo/fixtures");
    const page = (await as(db, null, () => db.query("select public.public_booking_page($1) as p", [f.business.slug]))).rows[0].p;
    const service = page.services.find((s: { deposit_type: string; places: { place: string }[] }) => s.deposit_type === "none" && s.places.some((p) => p.place === "salon"));
    // Cherche un créneau libre avec le moteur public, comme le ferait la page
    const { toAvailabilityContext, publicSlots } = await import("@/lib/domain/public-booking");
    const { addDays, localDate, zonedToUtc } = await import("@/lib/domain/time");
    const tz = page.settings.timezone;
    const today = localDate(new Date(), tz);
    let slot: Date | undefined;
    for (let d = 1; d < 20 && !slot; d++) {
      const day = addDays(today, d);
      const raw = (await as(db, null, () => db.query("select public.public_availability($1, $2, $3) as a", [f.business.slug, zonedToUtc(addDays(day, -1), 0, tz), zonedToUtc(addDays(day, 2), 0, tz)]))).rows[0].a;
      slot = publicSlots(day, service, "salon", toAvailabilityContext(raw, tz), { now: new Date(), windowDays: 60, stepMinutes: 15 })[0];
    }
    expect(slot).toBeDefined();
    const { randomUUID, createHash } = await import("node:crypto");
    const res = (
      await as(
        db,
        null,
        () =>
          db.query("select public.public_create_booking($1) as r", [
            JSON.stringify({
              slug: f.business.slug, service_id: service.id, place: "salon", starts_at: slot!.toISOString(),
              first_name: "Cliente", last_name: "Test", email: "cliente.test@exemple.demo", phone: "06 00 00 00 01",
              accept_terms: true, idempotency_key: randomUUID(), token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
            }),
          ]),
        { commit: true },
      )
    ).rows[0].r;
    const visible = await as(db, owner, () => db.query("select source, status from public.appointments where id = $1", [res.appointment_id]));
    expect(visible.rows[0]).toEqual({ source: "online", status: "confirmed" });
  });
});

/** Insère une ligne avec uniquement les colonnes fournies (les valeurs par défaut de la base s'appliquent). */
async function insertRow(table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await db.query(`insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, cols.map((c) => (Array.isArray(row[c]) ? row[c] : row[c])));
}

describe("déplacements fictifs (Sprint 5)", () => {
  it("véhicule et zones du studio démo respectent les contraintes de la base", async () => {
    const { demoFixtures: f } = await import("@/server/demo/fixtures");
    const { buildTravelRows } = await import("@/server/demo/seed");
    const rows = buildTravelRows(f.travel, biz);
    await as(
      db,
      owner,
      async () => {
        for (const v of rows.vehicles) await insertRow("vehicles", v);
        for (const a of rows.service_areas) await insertRow("service_areas", a);
        await db.query("update public.travel_settings set (start_point, return_point, safety_margin_pct, safety_margin_minutes, pricing_mode, per_km_cents, included_km, min_fee_cents, max_fee_cents) = ($2, $3, $4, $5, $6, $7, $8, $9, $10) where business_id = $1", [
          biz, f.travel.settings.start_point, f.travel.settings.return_point, f.travel.settings.safety_margin_pct, f.travel.settings.safety_margin_minutes,
          f.travel.settings.pricing_mode, f.travel.settings.per_km_cents, f.travel.settings.included_km, f.travel.settings.min_fee_cents, f.travel.settings.max_fee_cents,
        ]);
      },
      { commit: true },
    );
    const info = (await as(db, null, () => db.query("select public.public_travel_info($1) as i", [f.business.slug]))).rows[0].i;
    expect(info.pricing_mode).toBe("per_km");
    expect(info.areas.map((a: { name: string }) => a.name)).toContain("Nord toulousain");
  });

  it("les deux professionnelles supplémentaires (domicile seul, institut seul) ont une page publique valide", async () => {
    const { demoFixtures: f } = await import("@/server/demo/fixtures");
    const { buildExtraBusinessRows } = await import("@/server/demo/seed");
    for (const extra of f.extra_businesses) {
      const extraOwner = await createUser(db, `${extra.business.slug}@exemple.demo`);
      const id = await as(db, extraOwner, async () => (await db.query("select public.create_business($1) as id", [extra.business.name])).rows[0].id, { commit: true });
      await as(
        db,
        extraOwner,
        async () => {
          await db.query("update public.businesses set slug = $2, activity_mode = $3 where id = $1", [id, extra.business.slug, extra.business.activity_mode]);
          await db.query("update public.business_settings set booking_enabled = true, booking_window_days = $2, slot_step_minutes = $3 where business_id = $1", [id, extra.settings.booking_window_days, extra.settings.slot_step_minutes]);
          const rows = buildExtraBusinessRows(extra, id);
          for (const s of rows.services) await insertRow("services", s);
          for (const l of rows.service_locations) await db.query("insert into public.service_locations (business_id, service_id, place, price_cents) values ($1, $2, $3, $4)", [l.business_id, l.service_id, l.place, l.price_cents]);
          for (const r of rows.availability_rules) await db.query("insert into public.availability_rules (business_id, weekday, start_minute, end_minute, place) values ($1, $2, $3, $4, $5)", [r.business_id, r.weekday, r.start_minute, r.end_minute, r.place]);
        },
        { commit: true },
      );
      const page = (await as(db, null, () => db.query("select public.public_booking_page($1) as p", [extra.business.slug]))).rows[0].p;
      expect(page.has_hours).toBe(true);
      expect(page.services.length).toBe(extra.services.length);
      expect(new Set(page.services.flatMap((s: { places: { place: string }[] }) => s.places.map((p) => p.place)))).toEqual(new Set(extra.places));
    }
  });

  it("adresses de démonstration : seul le nom de rue est envoyé au service d'adresses", async () => {
    const { streetOnly } = await import("@/server/demo/travel");
    expect(streetOnly("12 rue des Fleurs (adresse fictive)")).toBe("rue des Fleurs");
    expect(streetOnly("5 bis chemin des Vignes")).toBe("chemin des Vignes");
    expect(streetOnly("Place du Capitole (lieu public, adresse fictive pour la démo)")).toBe("Place du Capitole");
  });
});
