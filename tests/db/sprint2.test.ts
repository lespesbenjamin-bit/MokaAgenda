/**
 * Sprint 2 — catalogue et clientes : sécurité multi-entreprises et contraintes,
 * exécutées sur PostgreSQL avec le rôle `authenticated` (jamais service_role).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, createUser } from "./helpers";

let db: Client;
let ownerA: string, ownerB: string, staffA: string;
let bizA: string, bizB: string;
let catA: string, catB: string;
let serviceA: string, serviceB: string;
let customerA: string, customerB: string;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows[0] as T;

async function business(owner: string, name: string) {
  return as(db, owner, async () => (await one<{ id: string }>("select public.create_business($1) as id", [name])).id, { commit: true });
}

beforeAll(async () => {
  db = await connect();
  ownerA = await createUser(db, "s2-a@example.fr");
  ownerB = await createUser(db, "s2-b@example.fr");
  staffA = await createUser(db, "s2-staff@example.fr");
  bizA = await business(ownerA, "Institut A S2");
  bizB = await business(ownerB, "Studio B S2");
  await db.query("insert into public.business_members (business_id, user_id, role) values ($1, $2, 'staff')", [bizA, staffA]);

  const seed = async (owner: string, biz: string, label: string) =>
    as(
      db,
      owner,
      async () => {
        const cat = await one<{ id: string }>(
          "insert into public.service_categories (business_id, name, position) values ($1, $2, 1) returning id",
          [biz, `Soins ${label}`],
        );
        const svc = await one<{ id: string }>(
          `insert into public.services (business_id, category_id, name, duration_minutes, base_price_cents, vat_rate_bps)
           values ($1, $2, $3, 60, 6000, 2000) returning id`,
          [biz, cat.id, `Soin visage ${label}`],
        );
        await db.query("insert into public.service_locations (business_id, service_id, place, price_cents) values ($1, $2, 'home', 7000), ($1, $2, 'salon', null)", [biz, svc.id]);
        await db.query("insert into public.service_costs (business_id, service_id, kind, amount_cents) values ($1, $2, 'consumables', 800)", [biz, svc.id]);
        const cust = await one<{ id: string }>(
          "insert into public.customers (business_id, first_name, last_name, email, phone) values ($1, 'Camille', $2, $3, '+33 6 12 34 56 78') returning id",
          [biz, `Client${label}`, `camille.${label.toLowerCase()}@example.fr`],
        );
        await db.query(
          "insert into public.customer_addresses (business_id, customer_id, kind, line1, city, is_primary) values ($1, $2, 'home', '1 rue X', 'Toulouse', true)",
          [biz, cust.id],
        );
        return { cat: cat.id, svc: svc.id, cust: cust.id };
      },
      { commit: true },
    );
  const a = await seed(ownerA, bizA, "A");
  const b = await seed(ownerB, bizB, "B");
  [catA, serviceA, customerA] = [a.cat, a.svc, a.cust];
  [catB, serviceB, customerB] = [b.cat, b.svc, b.cust];
});

afterAll(async () => db?.end());

describe("lecture", () => {
  it("chaque entreprise ne lit que ses propres données", async () => {
    await as(db, ownerA, async () => {
      for (const [table, own] of [
        ["service_categories", catA],
        ["services", serviceA],
        ["customers", customerA],
      ] as const) {
        const ids = (await db.query(`select id from public.${table}`)).rows.map((r) => r.id);
        expect(ids, table).toEqual([own]);
      }
      for (const table of ["service_locations", "service_costs", "customer_addresses"]) {
        const rows = (await db.query(`select business_id from public.${table}`)).rows;
        expect(rows.length, table).toBeGreaterThan(0);
        expect(rows.every((r) => r.business_id === bizA), table).toBe(true);
      }
    });
  });

  it("A ne trouve pas une prestation ou une cliente de B, même par identifiant", async () => {
    await as(db, ownerA, async () => {
      expect((await db.query("select 1 from public.services where id = $1", [serviceB])).rowCount).toBe(0);
      expect((await db.query("select 1 from public.customers where id = $1", [customerB])).rowCount).toBe(0);
      expect((await db.query("select 1 from public.customer_addresses where customer_id = $1", [customerB])).rowCount).toBe(0);
    });
  });

  it("un visiteur non connecté n'a accès à rien", async () => {
    await expect(as(db, null, () => db.query("select * from public.customers"))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query("select * from public.services"))).rejects.toThrow(/permission denied/);
  });
});

describe("modification et archivage interdits chez une autre entreprise", () => {
  it("A ne peut ni modifier ni archiver la prestation de B", async () => {
    await as(db, ownerA, async () => {
      expect((await db.query("update public.services set base_price_cents = 1 where id = $1", [serviceB])).rowCount).toBe(0);
      expect((await db.query("update public.services set archived_at = now() where id = $1", [serviceB])).rowCount).toBe(0);
      expect((await db.query("update public.service_categories set is_visible = false where id = $1", [catB])).rowCount).toBe(0);
    });
    expect((await one("select base_price_cents, archived_at from public.services where id = $1", [serviceB]))).toEqual({
      base_price_cents: 6000,
      archived_at: null,
    });
  });

  it("A ne peut ni modifier ni archiver la cliente de B", async () => {
    await as(db, ownerA, async () => {
      expect((await db.query("update public.customers set notes = 'x', archived_at = now() where id = $1", [customerB])).rowCount).toBe(0);
    });
    expect((await one("select archived_at from public.customers where id = $1", [customerB]))).toEqual({ archived_at: null });
  });

  it("A ne peut pas supprimer les adresses, tarifs ou coûts de B", async () => {
    await as(db, ownerA, async () => {
      expect((await db.query("delete from public.customer_addresses where customer_id = $1", [customerB])).rowCount).toBe(0);
      expect((await db.query("delete from public.service_locations where service_id = $1", [serviceB])).rowCount).toBe(0);
      expect((await db.query("delete from public.service_costs where service_id = $1", [serviceB])).rowCount).toBe(0);
    });
  });

  it("aucune suppression définitive des fiches principales (archivage uniquement)", async () => {
    await expect(as(db, ownerA, () => db.query("delete from public.customers where id = $1", [customerA]))).rejects.toThrow(/permission denied/);
    await expect(as(db, ownerA, () => db.query("delete from public.services where id = $1", [serviceA]))).rejects.toThrow(/permission denied/);
  });

  it("A ne peut pas dupliquer la prestation de B", async () => {
    await expect(as(db, ownerA, () => db.query("select public.duplicate_service($1)", [serviceB]))).rejects.toThrow(/introuvable/);
  });
});

describe("références croisées entre entreprises impossibles", () => {
  it("A ne peut pas classer sa prestation dans une catégorie de B", async () => {
    await expect(
      as(db, ownerA, () =>
        db.query("insert into public.services (business_id, category_id, name, duration_minutes, base_price_cents) values ($1, $2, 'X', 30, 100)", [bizA, catB]),
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(as(db, ownerA, () => db.query("update public.services set category_id = $1 where id = $2", [catB, serviceA]))).rejects.toThrow(
      /foreign key/,
    );
  });

  it("A ne peut pas ajouter une adresse, un consentement, un tarif ou un coût à une fiche de B", async () => {
    const attempts: [string, unknown[]][] = [
      ["insert into public.customer_addresses (business_id, customer_id, line1, city) values ($1, $2, 'x', 'y')", [bizA, customerB]],
      ["insert into public.customer_consents (business_id, customer_id, channel, granted) values ($1, $2, 'email', true)", [bizA, customerB]],
      ["insert into public.service_locations (business_id, service_id, place) values ($1, $2, 'home')", [bizA, serviceB]],
      ["insert into public.service_costs (business_id, service_id, kind, amount_cents) values ($1, $2, 'other', 1)", [bizA, serviceB]],
    ];
    for (const [sql, params] of attempts) {
      await expect(as(db, ownerA, () => db.query(sql, params)), sql).rejects.toThrow(/foreign key/);
    }
    // En se déclarant de l'entreprise B, c'est la RLS qui bloque
    await expect(
      as(db, ownerA, () =>
        db.query("insert into public.customer_addresses (business_id, customer_id, line1, city) values ($1, $2, 'x', 'y')", [bizB, customerB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("A ne peut pas créer de prestation ou de cliente au nom de B", async () => {
    await expect(
      as(db, ownerA, () => db.query("insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'X', 30, 100)", [bizB])),
    ).rejects.toThrow(/row-level security/);
    await expect(as(db, ownerA, () => db.query("insert into public.customers (business_id, first_name) values ($1, 'X')", [bizB]))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("une fiche ne peut pas être déplacée vers une autre entreprise", async () => {
    await expect(as(db, ownerA, () => db.query("update public.customers set business_id = $1 where id = $2", [bizB, customerA]))).rejects.toThrow();
    await expect(as(db, ownerA, () => db.query("update public.services set business_id = $1 where id = $2", [bizB, serviceA]))).rejects.toThrow();
  });

  it("la traçabilité ne peut pas être falsifiée", async () => {
    const row = await as(db, ownerA, () =>
      one<{ created_by: string }>("insert into public.customers (business_id, first_name, created_by) values ($1, 'Trace', $2) returning created_by", [
        bizA,
        ownerB,
      ]),
    );
    expect(row.created_by).toBe(ownerA);
  });
});

describe("permissions par rôle", () => {
  it("le staff gère les clientes mais pas le catalogue", async () => {
    await as(db, staffA, async () => {
      expect((await db.query("update public.customers set notes = 'vu' where id = $1", [customerA])).rowCount).toBe(1);
      expect((await db.query("update public.services set base_price_cents = 1 where id = $1", [serviceA])).rowCount).toBe(0);
      expect((await db.query("select id from public.services")).rows).toEqual([{ id: serviceA }]);
    });
    await expect(
      as(db, staffA, () => db.query("insert into public.service_categories (business_id, name) values ($1, 'X')", [bizA])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("prestations : règles et opérations", () => {
  it("refuse un acompte en pourcentage hors de 0 à 100 et des montants négatifs", async () => {
    const insert = (deposit: string, value: number, price = 5000) =>
      as(db, ownerA, () =>
        db.query(
          `insert into public.services (business_id, name, duration_minutes, base_price_cents, deposit_type, deposit_value)
           values ($1, 'Test acompte', 30, $2, $3, $4)`,
          [bizA, price, deposit, value],
        ),
      );
    await expect(insert("percentage", 120)).rejects.toThrow(/services_deposit_valid/);
    await expect(insert("fixed", -1)).rejects.toThrow(/services_deposit_valid/);
    await expect(insert("none", 10)).rejects.toThrow(/services_deposit_valid/);
    await expect(insert("none", 0, -5)).rejects.toThrow(/check constraint/);
    await expect(insert("percentage", 30)).resolves.toBeDefined();
  });

  it("refuse un prix promotionnel supérieur au prix de base et une TVA non prévue", async () => {
    await expect(
      as(db, ownerA, () =>
        db.query("insert into public.services (business_id, name, duration_minutes, base_price_cents, promo_price_cents) values ($1, 'P', 30, 1000, 2000)", [bizA]),
      ),
    ).rejects.toThrow(/services_promo_le_base/);
    await expect(
      as(db, ownerA, () => db.query("insert into public.services (business_id, name, duration_minutes, base_price_cents, vat_rate_bps) values ($1, 'T', 30, 1000, 1900)", [bizA])),
    ).rejects.toThrow(/check constraint/);
  });

  it("refuse deux prestations actives du même nom", async () => {
    await expect(
      as(db, ownerA, () => db.query("insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'soin visage a', 30, 1)", [bizA])),
    ).rejects.toThrow(/duplicate key/);
  });

  it("duplique une prestation avec ses tarifs et coûts, inactive par défaut", async () => {
    const copy = await as(db, ownerA, async () => {
      const { id } = await one<{ id: string }>("select public.duplicate_service($1) as id", [serviceA]);
      const svc = await one("select name, is_active, base_price_cents from public.services where id = $1", [id]);
      const places = (await db.query("select place, price_cents from public.service_locations where service_id = $1 order by place", [id])).rows;
      const costs = (await db.query("select kind, amount_cents from public.service_costs where service_id = $1", [id])).rows;
      const again = await one<{ id: string }>("select public.duplicate_service($1) as id", [serviceA]);
      const name2 = await one<{ name: string }>("select name from public.services where id = $1", [again.id]);
      return { svc, places, costs, name2: name2.name };
    });
    expect(copy.svc).toEqual({ name: "Soin visage A (copie)", is_active: false, base_price_cents: 6000 });
    expect(copy.places).toEqual([
      { place: "home", price_cents: 7000 },
      { place: "salon", price_cents: null },
    ]);
    expect(copy.costs).toEqual([{ kind: "consumables", amount_cents: 800 }]);
    expect(copy.name2).toBe("Soin visage A (copie 2)");
  });

  it("un nom archivé peut être réutilisé (archivage sans perte d'historique)", async () => {
    await as(db, ownerA, async () => {
      const { id } = await one<{ id: string }>(
        "insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'Ancienne', 30, 1) returning id",
        [bizA],
      );
      await db.query("update public.services set archived_at = now() where id = $1", [id]);
      await db.query("insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'Ancienne', 30, 1)", [bizA]);
      expect((await db.query("select 1 from public.services where name = 'Ancienne'")).rowCount).toBe(2);
    });
  });
});

describe("clientes : règles", () => {
  it("normalise email et téléphone pour la recherche de doublons", async () => {
    const row = await as(db, ownerA, () =>
      one("select email_normalized, phone_normalized from public.customers where id = $1", [customerA]),
    );
    expect(row).toEqual({ email_normalized: "camille.a@example.fr", phone_normalized: "0612345678" });
  });

  it("une seule adresse principale par cliente", async () => {
    await expect(
      as(db, ownerA, () =>
        db.query("insert into public.customer_addresses (business_id, customer_id, line1, city, is_primary) values ($1, $2, '2 rue', 'Blagnac', true)", [bizA, customerA]),
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("plusieurs adresses secondaires possibles", async () => {
    await as(db, ownerA, async () => {
      await db.query(
        "insert into public.customer_addresses (business_id, customer_id, kind, line1, city) values ($1, $2, 'work', 'Bureau', 'Blagnac'), ($1, $2, 'other', 'Mère', 'Muret')",
        [bizA, customerA],
      );
      expect((await db.query("select 1 from public.customer_addresses where customer_id = $1", [customerA])).rowCount).toBe(3);
    });
  });

  it("refuse des coordonnées GPS non validées par un géocodage", async () => {
    await expect(
      as(db, ownerA, () =>
        db.query("insert into public.customer_addresses (business_id, customer_id, line1, city, latitude, longitude) values ($1, $2, 'x', 'y', 43.6, 1.44)", [bizA, customerA]),
      ),
    ).rejects.toThrow(/coords_validated/);
  });

  it("l'import est idempotent : une même ligne ne peut être importée deux fois", async () => {
    await as(db, ownerA, async () => {
      await db.query("insert into public.customers (business_id, first_name, source, import_key) values ($1, 'Import', 'import', 'cle-123')", [bizA]);
      await expect(
        db.query("insert into public.customers (business_id, first_name, source, import_key) values ($1, 'Import', 'import', 'cle-123')", [bizA]),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  it("exige au moins un prénom ou un nom", async () => {
    await expect(as(db, ownerA, () => db.query("insert into public.customers (business_id) values ($1)", [bizA]))).rejects.toThrow(/customers_has_name/);
  });

  it("un consentement par canal, modifiable", async () => {
    await as(db, ownerA, async () => {
      await db.query("insert into public.customer_consents (business_id, customer_id, channel, granted) values ($1, $2, 'email', true)", [bizA, customerA]);
      await db.query("savepoint avant_doublon");
      await expect(
        db.query("insert into public.customer_consents (business_id, customer_id, channel, granted) values ($1, $2, 'email', false)", [bizA, customerA]),
      ).rejects.toThrow(/duplicate key/);
      await db.query("rollback to savepoint avant_doublon");
      const r = await db.query("update public.customer_consents set granted = false where customer_id = $1 and channel = 'email'", [customerA]);
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("stockage des photos de prestations", () => {
  it("A dépose dans son dossier, jamais dans celui de B ; le staff ne dépose pas", async () => {
    const put = (path: string) => db.query("insert into storage.objects (bucket_id, name) values ('service-photos', $1)", [path]);
    await expect(as(db, ownerA, () => put(`${bizA}/soin.jpg`))).resolves.toBeDefined();
    await expect(as(db, ownerA, () => put(`${bizB}/soin.jpg`))).rejects.toThrow(/row-level security/);
    await expect(as(db, staffA, () => put(`${bizA}/autre.jpg`))).rejects.toThrow(/row-level security/);
  });
});
