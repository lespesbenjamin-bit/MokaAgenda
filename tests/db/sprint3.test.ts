/**
 * Sprint 3 — agenda : conflits, horaires, pauses, fermetures, statuts,
 * instantanés de prix, isolation, concurrence et fuseaux horaires.
 * Exécuté sur PostgreSQL avec le rôle `authenticated` (jamais service_role).
 *
 * Dates de référence (Europe/Paris, heure d'hiver = UTC+1) :
 *   lundi 4 janvier 2027, mardi 5, mercredi 6.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { as, connect, createUser, TEST_DATABASE_URL } from "./helpers";

let db: Client;
let ownerA: string, ownerB: string, staffA: string;
let bizA: string, bizB: string;
let customerA: string, customerB: string, addressA: string;
let serviceA: string, serviceBuffer: string;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;

function payload(over: Record<string, unknown> = {}) {
  return {
    business_id: bizA,
    customer_id: customerA,
    place: "salon",
    status: "confirmed",
    starts_at: "2027-01-04T09:00:00Z", // lundi 10:00 Paris
    duration_minutes: 60,
    prep_minutes: 0,
    cleanup_minutes: 0,
    buffer_minutes: 0,
    items: [
      {
        service_id: serviceA,
        service_name: "Soin visage",
        duration_minutes: 60,
        catalog_price_cents: 6000,
        unit_price_cents: 6000,
        price_ht_cents: 6000,
        deposit_type: "percentage",
        deposit_amount_cents: 1800,
        consumables_cents: 500,
      },
    ],
    ...over,
  };
}

const create = (user: string, p: Record<string, unknown>) =>
  as(db, user, async () => (await one<{ id: string }>("select public.create_appointment($1) as id", [JSON.stringify(p)])).id, { commit: true });

beforeAll(async () => {
  db = await connect();
  ownerA = await createUser(db, "s3-a@example.fr");
  ownerB = await createUser(db, "s3-b@example.fr");
  staffA = await createUser(db, "s3-staff@example.fr");
  bizA = await as(db, ownerA, async () => (await one<{ id: string }>("select public.create_business('Agenda A') as id")).id, { commit: true });
  bizB = await as(db, ownerB, async () => (await one<{ id: string }>("select public.create_business('Agenda B') as id")).id, { commit: true });
  await db.query("insert into public.business_members (business_id, user_id, role) values ($1, $2, 'staff')", [bizA, staffA]);

  await as(
    db,
    ownerA,
    async () => {
      // Lundi : matin institut 9h-12h, après-midi domicile 14h-18h ; mardi 9h-18h tous lieux ; mercredi fermé ; dimanche 9h-12h
      await db.query(
        `insert into public.availability_rules (business_id, weekday, start_minute, end_minute, place) values
         ($1, 1, 540, 720, 'salon'), ($1, 1, 840, 1080, 'home'), ($1, 2, 540, 1080, null), ($1, 7, 540, 720, null)`,
        [bizA],
      );
      customerA = (await one<{ id: string }>("insert into public.customers (business_id, first_name) values ($1, 'Léa') returning id", [bizA])).id;
      addressA = (
        await one<{ id: string }>(
          "insert into public.customer_addresses (business_id, customer_id, line1, city, is_primary) values ($1, $2, '1 rue A', 'Toulouse', true) returning id",
          [bizA, customerA],
        )
      ).id;
      serviceA = (await one<{ id: string }>("insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'Soin visage', 60, 6000) returning id", [bizA])).id;
      serviceBuffer = (
        await one<{ id: string }>(
          "insert into public.services (business_id, name, duration_minutes, buffer_minutes, base_price_cents) values ($1, 'Massage', 30, 15, 4000) returning id",
          [bizA],
        )
      ).id;
    },
    { commit: true },
  );
  await as(
    db,
    ownerB,
    async () => {
      await db.query("insert into public.availability_rules (business_id, weekday, start_minute, end_minute) values ($1, 1, 0, 1440)", [bizB]);
      customerB = (await one<{ id: string }>("insert into public.customers (business_id, first_name) values ($1, 'Bea') returning id", [bizB])).id;
    },
    { commit: true },
  );
});

afterAll(async () => db?.end());

describe("création et instantané", () => {
  let id: string;
  it("crée un rendez-vous avec horaires calculés, montants et prestation figés", async () => {
    id = await create(ownerA, payload());
    const a = await one("select ends_at, price_total_cents, deposit_amount_cents, balance_due_cents, status from public.appointments where id = $1", [id]);
    expect(a).toMatchObject({ price_total_cents: 6000, deposit_amount_cents: 1800, balance_due_cents: 4200, status: "confirmed" });
    expect((a.ends_at as Date).toISOString()).toBe("2027-01-04T10:00:00.000Z");
    const item = await one("select service_name, unit_price_cents, consumables_cents, price_overridden from public.appointment_items where appointment_id = $1", [id]);
    expect(item).toEqual({ service_name: "Soin visage", unit_price_cents: 6000, consumables_cents: 500, price_overridden: false });
  });

  it("enregistre l'événement de création dans l'historique", async () => {
    const ev = await one("select event_type, to_status, actor_id from public.booking_events where appointment_id = $1", [id]);
    expect(ev).toEqual({ event_type: "created", to_status: "confirmed", actor_id: ownerA });
  });

  it("un changement de tarif du catalogue ne modifie pas le rendez-vous", async () => {
    await as(db, ownerA, () => db.query("update public.services set base_price_cents = 9900 where id = $1", [serviceA]), { commit: true });
    expect((await one("select unit_price_cents from public.appointment_items where appointment_id = $1", [id])).unit_price_cents).toBe(6000);
    expect((await one("select price_total_cents from public.appointments where id = $1", [id])).price_total_cents).toBe(6000);
  });

  it("une prestation archivée reste identifiable dans l'historique", async () => {
    await as(db, ownerA, () => db.query("update public.services set archived_at = now() where id = $1", [serviceA]), { commit: true });
    const row = await one(
      "select i.service_name, s.archived_at is not null as archived from public.appointment_items i join public.services s on s.id = i.service_id where i.appointment_id = $1",
      [id],
    );
    expect(row).toEqual({ service_name: "Soin visage", archived: true });
    await as(db, ownerA, () => db.query("update public.services set archived_at = null where id = $1", [serviceA]), { commit: true });
  });

  it("enregistre un prix modifié manuellement sans toucher au catalogue", async () => {
    const pid = await create(ownerA, payload({ starts_at: "2027-01-05T08:00:00Z", items: [{ ...payload().items[0], unit_price_cents: 5000 }] }));
    expect(await one("select unit_price_cents, catalog_price_cents, price_overridden from public.appointment_items where appointment_id = $1", [pid])).toEqual({
      unit_price_cents: 5000,
      catalog_price_cents: 6000,
      price_overridden: true,
    });
    expect((await one("select base_price_cents from public.services where id = $1", [serviceA])).base_price_cents).toBe(9900);
  });

  it("refuse un rendez-vous sans prestation", async () => {
    await expect(create(ownerA, payload({ starts_at: "2027-01-05T13:00:00Z", items: [] }))).rejects.toThrow(/MOKA_NO_SERVICE/);
  });
});

describe("conflits horaires", () => {
  it("refuse deux rendez-vous qui se chevauchent", async () => {
    await expect(create(ownerA, payload({ starts_at: "2027-01-04T09:30:00Z" }))).rejects.toThrow(/appointments_no_overlap/);
  });

  it("accepte un rendez-vous qui commence exactement à la fin du précédent", async () => {
    await expect(create(ownerA, payload({ starts_at: "2027-01-04T10:00:00Z" }))).resolves.toBeDefined(); // 11:00 Paris
  });

  it("tient compte du temps tampon et de la préparation", async () => {
    // Mardi 14:00-14:30 + 15 min de tampon → bloqué jusqu'à 14:45
    await create(ownerA, payload({ starts_at: "2027-01-05T13:00:00Z", duration_minutes: 30, buffer_minutes: 15, items: [{ ...payload().items[0], service_id: serviceBuffer, duration_minutes: 30 }] }));
    await expect(create(ownerA, payload({ starts_at: "2027-01-05T13:40:00Z", duration_minutes: 30 }))).rejects.toThrow(/appointments_no_overlap/);
    await expect(create(ownerA, payload({ starts_at: "2027-01-05T14:00:00Z", duration_minutes: 30, prep_minutes: 20 }))).rejects.toThrow(/appointments_no_overlap/);
    await expect(create(ownerA, payload({ starts_at: "2027-01-05T13:45:00Z", duration_minutes: 30 }))).resolves.toBeDefined();
  });

  it("un rendez-vous annulé libère le créneau", async () => {
    const id = await create(ownerA, payload({ starts_at: "2027-01-05T15:00:00Z" }));
    await as(db, ownerA, () => db.query("update public.appointments set status = 'cancelled', cancel_reason = 'Malade' where id = $1", [id]), { commit: true });
    await expect(create(ownerA, payload({ starts_at: "2027-01-05T15:00:00Z" }))).resolves.toBeDefined();
  });
});

describe("horaires, pauses, fermetures", () => {
  it("refuse un rendez-vous pendant la pause de midi", async () => {
    await expect(create(ownerA, payload({ starts_at: "2027-01-04T11:30:00Z" }))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // 12:30
  });
  it("refuse une durée qui dépasse la fin de la plage", async () => {
    await expect(create(ownerA, payload({ starts_at: "2027-01-04T10:30:00Z" }))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // 11:30 + 60 min > 12:00
  });
  it("refuse un jour fermé et avant l'ouverture", async () => {
    await expect(create(ownerA, payload({ starts_at: "2027-01-06T09:00:00Z" }))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // mercredi
    await expect(create(ownerA, payload({ starts_at: "2027-01-05T07:30:00Z" }))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // mardi 8:30
  });
  it("respecte l'alternance domicile / institut d'une professionnelle hybride", async () => {
    const home = { place: "home", address_id: addressA, address_line1: "1 rue A", city: "Toulouse" };
    await expect(create(ownerA, payload({ ...home, starts_at: "2027-01-04T08:00:00Z" }))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // lundi 9h, domicile
    await expect(create(ownerA, payload({ starts_at: "2027-01-04T14:00:00Z" }))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // lundi 15h, institut
    await expect(create(ownerA, payload({ ...home, starts_at: "2027-01-04T14:00:00Z" }))).resolves.toBeDefined(); // lundi 15h, domicile
  });
  it("exige une adresse pour un rendez-vous à domicile", async () => {
    await expect(create(ownerA, payload({ place: "home", starts_at: "2027-01-04T15:30:00Z" }))).rejects.toThrow(/appointments_home_address/);
  });
  it("refuse un rendez-vous pendant un congé ou une fermeture, selon le lieu concerné", async () => {
    await as(
      db,
      ownerA,
      () =>
        db.query(
          `insert into public.availability_exceptions (business_id, kind, starts_at, ends_at, place) values
           ($1, 'vacation', '2027-01-12T00:00:00+01', '2027-01-13T00:00:00+01', null),
           ($1, 'unavailable', '2027-01-19T09:00:00+01', '2027-01-19T12:00:00+01', 'home')`,
          [bizA],
        ),
      { commit: true },
    );
    await expect(create(ownerA, payload({ starts_at: "2027-01-12T09:00:00Z" }))).rejects.toThrow(/MOKA_BLOCKED_PERIOD/);
    // Indisponibilité « domicile » seulement : l'institut reste réservable
    await expect(create(ownerA, payload({ starts_at: "2027-01-19T09:00:00Z" }))).resolves.toBeDefined();
    await expect(
      create(ownerA, payload({ place: "home", address_line1: "1 rue A", city: "Toulouse", starts_at: "2027-01-19T08:00:00Z" })),
    ).rejects.toThrow(/MOKA_BLOCKED_PERIOD/);
  });
  it("empêche deux plages horaires qui se chevauchent le même jour", async () => {
    await expect(
      as(db, ownerA, () => db.query("insert into public.availability_rules (business_id, weekday, start_minute, end_minute) values ($1, 1, 660, 900)", [bizA])),
    ).rejects.toThrow(/availability_rules_no_overlap/);
  });
});

describe("modification et déplacement", () => {
  it("déplace un rendez-vous et historise le déplacement", async () => {
    const id = await create(ownerA, payload({ starts_at: "2027-01-26T09:00:00Z" })); // mardi 26
    await as(db, ownerA, () => db.query("select public.update_appointment($1, $2)", [id, JSON.stringify({ starts_at: "2027-01-26T13:00:00Z" })]), { commit: true });
    const ev = await one("select event_type, old_starts_at, new_starts_at from public.booking_events where appointment_id = $1 order by created_at desc limit 1", [id]);
    expect(ev.event_type).toBe("rescheduled");
    expect((ev.new_starts_at as Date).toISOString()).toBe("2027-01-26T13:00:00.000Z");
  });

  it("un déplacement vers un créneau occupé échoue sans rien modifier", async () => {
    const a = await create(ownerA, payload({ starts_at: "2027-02-02T09:00:00Z" }));
    const b = await create(ownerA, payload({ starts_at: "2027-02-02T11:00:00Z" }));
    await expect(
      as(db, ownerA, () => db.query("select public.update_appointment($1, $2)", [b, JSON.stringify({ starts_at: "2027-02-02T09:30:00Z" })]), { commit: true }),
    ).rejects.toThrow(/appointments_no_overlap/);
    expect(((await one("select starts_at from public.appointments where id = $1", [b])).starts_at as Date).toISOString()).toBe("2027-02-02T11:00:00.000Z");
    expect(a).toBeDefined();
  });

  it("remplace la prestation et recalcule les montants", async () => {
    const id = await create(ownerA, payload({ starts_at: "2027-02-09T09:00:00Z" }));
    await as(
      db,
      ownerA,
      () =>
        db.query("select public.update_appointment($1, $2)", [
          id,
          JSON.stringify({ items: [{ service_id: serviceBuffer, service_name: "Massage", duration_minutes: 30, catalog_price_cents: 4000, unit_price_cents: 4000, price_ht_cents: 4000 }], duration_minutes: 30 }),
        ]),
      { commit: true },
    );
    expect(await one("select price_total_cents, deposit_amount_cents, balance_due_cents, duration_minutes from public.appointments where id = $1", [id])).toEqual({
      price_total_cents: 4000,
      deposit_amount_cents: 0,
      balance_due_cents: 4000,
      duration_minutes: 30,
    });
  });
});

describe("statuts", () => {
  it("suit les transitions autorisées et historise chaque changement", async () => {
    const id = await create(ownerA, payload({ starts_at: "2027-02-16T09:00:00Z", status: "pending" }));
    await as(db, ownerA, () => db.query("update public.appointments set status = 'confirmed' where id = $1", [id]), { commit: true });
    await expect(as(db, ownerA, () => db.query("update public.appointments set status = 'pending' where id = $1", [id]))).rejects.toThrow(/MOKA_STATUS_TRANSITION/);
    await expect(as(db, ownerA, () => db.query("update public.appointments set status = 'completed' where id = $1", [id]))).rejects.toThrow(/MOKA_STATUS_NOT_ALLOWED/);
    await as(db, ownerA, () => db.query("update public.appointments set status = 'cancelled' where id = $1", [id]), { commit: true });
    const types = (await db.query("select event_type from public.booking_events where appointment_id = $1 order by created_at", [id])).rows.map((r) => r.event_type);
    expect(types).toEqual(["created", "status_changed", "cancelled"]);
    expect((await one("select cancelled_at is not null as c from public.appointments where id = $1", [id])).c).toBe(true);
  });

  it("un rendez-vous annulé ou terminé ne peut plus être déplacé ni rouvert", async () => {
    const id = await create(ownerA, payload({ starts_at: "2027-02-23T09:00:00Z" }));
    await as(db, ownerA, () => db.query("update public.appointments set status = 'cancelled' where id = $1", [id]), { commit: true });
    await expect(as(db, ownerA, () => db.query("update public.appointments set status = 'confirmed' where id = $1", [id]))).rejects.toThrow(/MOKA_APPOINTMENT_LOCKED/);
    await expect(as(db, ownerA, () => db.query("select public.update_appointment($1, $2)", [id, JSON.stringify({ starts_at: "2027-02-23T10:00:00Z" })]))).rejects.toThrow(
      /MOKA_APPOINTMENT_LOCKED/,
    );
  });

  it("un rendez-vous passé peut être marqué terminé ou « cliente absente »", async () => {
    // Insertion directe d'un rendez-vous passé (hors règles horaires : statut déjà clos à la création)
    const past = await as(
      db,
      ownerA,
      async () =>
        (
          await one<{ id: string }>(
            "insert into public.appointments (business_id, customer_id, place, status, starts_at, duration_minutes) values ($1, $2, 'salon', 'completed', now() - interval '3 days', 60) returning id",
            [bizA, customerA],
          )
        ).id,
      { commit: true },
    );
    expect((await one("select status from public.appointments where id = $1", [past])).status).toBe("completed");
    await expect(
      as(db, ownerA, () =>
        db.query("insert into public.appointments (business_id, customer_id, place, status, starts_at, duration_minutes) values ($1, $2, 'salon', 'completed', now() + interval '3 days', 60)", [
          bizA,
          customerA,
        ]),
      ),
    ).rejects.toThrow(/MOKA_STATUS_NOT_ALLOWED/);
  });

  it("l'historique ne peut être ni écrit ni effacé par une utilisatrice", async () => {
    await expect(as(db, ownerA, () => db.query("delete from public.booking_events where business_id = $1", [bizA]))).rejects.toThrow(/permission denied/);
    await expect(
      as(db, ownerA, async () => {
        const a = await one<{ id: string }>("select id from public.appointments where business_id = $1 limit 1", [bizA]);
        await db.query("insert into public.booking_events (business_id, appointment_id, event_type) values ($1, $2, 'created')", [bizA, a.id]);
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db, ownerA, () => db.query("delete from public.appointments where business_id = $1", [bizA]))).rejects.toThrow(/permission denied/);
  });
});

describe("isolation entre entreprises", () => {
  it("B ne voit ni les rendez-vous, ni les horaires, ni l'historique de A", async () => {
    await as(db, ownerB, async () => {
      for (const t of ["appointments", "appointment_items", "availability_rules", "availability_exceptions", "booking_events"]) {
        const rows = (await db.query(`select 1 from public.${t} where business_id = $1`, [bizA])).rows;
        expect(rows, t).toHaveLength(0);
      }
    });
  });
  it("B ne peut ni modifier, ni annuler, ni déplacer un rendez-vous de A", async () => {
    const id = (await one<{ id: string }>("select id from public.appointments where business_id = $1 and status = 'confirmed' limit 1", [bizA])).id;
    await as(db, ownerB, async () => {
      expect((await db.query("update public.appointments set status = 'cancelled' where id = $1", [id])).rowCount).toBe(0);
    });
    await expect(as(db, ownerB, () => db.query("select public.update_appointment($1, $2)", [id, JSON.stringify({ starts_at: "2027-01-04T15:00:00Z" })]))).rejects.toThrow(/MOKA_NOT_FOUND/);
  });
  it("B ne peut pas créer un rendez-vous chez A, ni pour une cliente ou une adresse de A", async () => {
    await expect(create(ownerB, payload({ starts_at: "2027-03-01T09:00:00Z" }))).rejects.toThrow(/row-level security/);
    await expect(create(ownerB, payload({ business_id: bizB, customer_id: customerA, items: [{ ...payload().items[0], service_id: null }] }))).rejects.toThrow(/foreign key/);
    await expect(
      create(ownerB, payload({ business_id: bizB, customer_id: customerB, place: "home", address_id: addressA, address_line1: "x", city: "y", items: [{ ...payload().items[0], service_id: null }] })),
    ).rejects.toThrow(/foreign key/);
    await expect(create(ownerB, payload({ business_id: bizB, customer_id: customerB, items: [{ ...payload().items[0], service_id: serviceA }] }))).rejects.toThrow(/foreign key/);
  });
  it("les rendez-vous de B n'entrent jamais en conflit avec ceux de A", async () => {
    await expect(create(ownerB, payload({ business_id: bizB, customer_id: customerB, items: [{ ...payload().items[0], service_id: null }] }))).resolves.toBeDefined();
  });
  it("le staff crée des rendez-vous mais ne modifie pas les horaires", async () => {
    await expect(create(staffA, payload({ starts_at: "2027-03-02T09:00:00Z" }))).resolves.toBeDefined();
    await expect(
      as(db, staffA, () => db.query("insert into public.availability_rules (business_id, weekday, start_minute, end_minute) values ($1, 3, 540, 600)", [bizA])),
    ).rejects.toThrow(/row-level security/);
  });
  it("les blocages temporaires de réservation en ligne restent inaccessibles", async () => {
    await expect(as(db, ownerA, () => db.query("select * from public.booking_holds"))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select * from public.appointments"))).rejects.toThrow(/permission denied/);
  });
});

describe("réservations simultanées", () => {
  it("deux réservations du même créneau au même instant : une seule réussit", async () => {
    const c1 = new Client({ connectionString: TEST_DATABASE_URL });
    const c2 = new Client({ connectionString: TEST_DATABASE_URL });
    await Promise.all([c1.connect(), c2.connect()]);
    const p = JSON.stringify(payload({ starts_at: "2027-03-09T09:00:00Z" }));
    const attempt = async (c: Client) => {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerA, role: "authenticated" })]);
      try {
        await c.query("select public.create_appointment($1)", [p]);
        await new Promise((r) => setTimeout(r, 150)); // garde la transaction ouverte
        await c.query("commit");
        return "ok";
      } catch (e) {
        await c.query("rollback");
        return (e as Error).message;
      }
    };
    const results = await Promise.all([attempt(c1), attempt(c2)]);
    await Promise.all([c1.end(), c2.end()]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.find((r) => r !== "ok")).toMatch(/appointments_no_overlap/);
    const n = await one<{ n: string }>("select count(*) as n from public.appointments where business_id = $1 and starts_at = '2027-03-09T09:00:00Z' and status <> 'cancelled'", [bizA]);
    expect(Number(n.n)).toBe(1);
  });
});

describe("fuseaux horaires et changement d'heure", () => {
  it("le jour du passage à l'heure d'été, les horaires restent en heure locale", async () => {
    // Dimanche 28 mars 2027 : Paris passe à UTC+2. Plage 9h-12h.
    await expect(create(ownerA, payload({ starts_at: "2027-03-28T07:00:00Z" }))).resolves.toBeDefined(); // 9:00 locale
    await expect(create(ownerA, payload({ starts_at: "2027-03-28T06:30:00Z" }))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // 8:30 locale
    await expect(create(ownerA, payload({ starts_at: "2027-03-28T09:30:00Z" }))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // 11:30 + 60 min
    await expect(create(ownerA, payload({ starts_at: "2027-03-28T09:00:00Z" }))).resolves.toBeDefined(); // 11:00-12:00 locale
  });
  it("utilise le fuseau de l'entreprise (ex. Martinique, UTC−4)", async () => {
    await as(db, ownerB, () => db.query("update public.business_settings set timezone = 'America/Martinique' where business_id = $1", [bizB]), { commit: true });
    await as(db, ownerB, () => db.query("insert into public.availability_rules (business_id, weekday, start_minute, end_minute) values ($1, 2, 540, 720)", [bizB]), { commit: true });
    const p = (iso: string) => payload({ business_id: bizB, customer_id: customerB, starts_at: iso, items: [{ ...payload().items[0], service_id: null }] });
    await expect(create(ownerB, p("2027-01-05T13:00:00Z"))).resolves.toBeDefined(); // 9:00 en Martinique
    await expect(create(ownerB, p("2027-01-05T09:00:00Z"))).rejects.toThrow(/MOKA_OUTSIDE_HOURS/); // 5:00 en Martinique
  });
});

describe("enregistrement des horaires", () => {
  it("remplace toute la semaine d'un coup, ou rien en cas d'erreur", async () => {
    const count = async () => Number((await one<{ n: string }>("select count(*) as n from public.availability_rules where business_id = $1", [bizB])).n);
    const before = await count();
    await expect(
      as(db, ownerB, () =>
        db.query("select public.replace_availability_rules($1, $2)", [
          bizB,
          JSON.stringify([
            { weekday: 4, start_minute: 540, end_minute: 720 },
            { weekday: 4, start_minute: 600, end_minute: 800 },
          ]),
        ]),
      { commit: true }),
    ).rejects.toThrow(/availability_rules_no_overlap/);
    expect(await count()).toBe(before);
    await as(db, ownerB, () => db.query("select public.replace_availability_rules($1, $2)", [bizB, JSON.stringify([{ weekday: 4, start_minute: 540, end_minute: 720, place: "home" }])]), {
      commit: true,
    });
    expect(await count()).toBe(1);
  });
  it("une autre entreprise ne peut pas remplacer mes horaires", async () => {
    await as(db, ownerA, () => db.query("select public.replace_availability_rules($1, '[]'::jsonb)", [bizB]), { commit: true }).catch(() => undefined);
    expect(Number((await one<{ n: string }>("select count(*) as n from public.availability_rules where business_id = $1", [bizB])).n)).toBe(1);
    await expect(
      as(db, ownerA, () => db.query("select public.replace_availability_rules($1, $2)", [bizB, JSON.stringify([{ weekday: 5, start_minute: 0, end_minute: 60 }])])),
    ).rejects.toThrow(/row-level security/);
  });
});
