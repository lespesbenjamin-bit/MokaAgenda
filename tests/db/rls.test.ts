/**
 * Tests de sécurité multi-entreprises (RLS) — exécutés sur un vrai PostgreSQL
 * avec les migrations du dépôt. Chaque requête utilisateur passe par le rôle
 * `authenticated` avec un JWT simulé : jamais de service_role.
 *
 * Lancer : npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, createUser } from "./helpers";

let db: Client;
let userA: string;
let userB: string;
let staffA: string;
let outsider: string;
let businessA: string;
let businessB: string;
let locationB: string;

async function createBusinessAs(userId: string, name: string): Promise<string> {
  return as(
    db,
    userId,
    async () => {
      const { rows } = await db.query<{ id: string }>(
        "select public.create_business($1, $2, $3, $4) as id",
        [name, "Esthéticienne", "0600000000", "contact@example.fr"],
      );
      return rows[0].id;
    },
    { commit: true },
  );
}

beforeAll(async () => {
  db = await connect();
  userA = await createUser(db, "a@example.fr", "Alice A");
  userB = await createUser(db, "b@example.fr", "Béa B");
  staffA = await createUser(db, "staff-a@example.fr");
  outsider = await createUser(db, "sans-entreprise@example.fr");

  businessA = await createBusinessAs(userA, "Institut A");
  businessB = await createBusinessAs(userB, "Studio B");

  // Un membre « staff » dans A (inséré côté serveur : pas d'invitation au Sprint 1)
  await db.query("insert into public.business_members (business_id, user_id, role) values ($1, $2, 'staff')", [
    businessA,
    staffA,
  ]);

  locationB = await as(
    db,
    userB,
    async () => {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.locations (business_id, kind, address_line1, city) values ($1, 'salon', '1 rue B', 'Toulouse') returning id",
        [businessB],
      );
      return rows[0].id;
    },
    { commit: true },
  );
});

afterAll(async () => {
  await db?.end();
});

describe("création d'entreprise", () => {
  it("crée l'entreprise, le membre propriétaire et les paramètres en une transaction", async () => {
    const { rows: members } = await db.query(
      "select role from public.business_members where business_id = $1 and user_id = $2",
      [businessA, userA],
    );
    expect(members).toEqual([{ role: "business_owner" }]);
    const { rows: settings } = await db.query(
      "select timezone, currency, default_appointment_minutes from public.business_settings where business_id = $1",
      [businessA],
    );
    expect(settings).toEqual([{ timezone: "Europe/Paris", currency: "EUR", default_appointment_minutes: 60 }]);
  });

  it("crée automatiquement le profil à l'inscription", async () => {
    const { rows } = await db.query("select full_name from public.profiles where id = $1", [userA]);
    expect(rows).toEqual([{ full_name: "Alice A" }]);
  });

  it("est idempotente : un second appel renvoie la même entreprise", async () => {
    expect(await createBusinessAs(userA, "Autre nom")).toBe(businessA);
  });

  it("refuse un visiteur non connecté", async () => {
    await expect(as(db, null, () => db.query("select public.create_business('X')"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("isolation : l'utilisateur A face à l'entreprise B", () => {
  it("A ne voit que sa propre entreprise", async () => {
    const rows = await as(db, userA, async () => (await db.query("select id from public.businesses")).rows);
    expect(rows).toEqual([{ id: businessA }]);
  });

  it("A ne peut pas lire l'entreprise B, même en ciblant son identifiant", async () => {
    const rows = await as(db, userA, async () =>
      (await db.query("select * from public.businesses where id = $1", [businessB])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("A ne peut pas modifier l'entreprise B", async () => {
    const count = await as(db, userA, async () =>
      (await db.query("update public.businesses set name = 'Piraté' where id = $1", [businessB])).rowCount,
    );
    expect(count).toBe(0);
    const { rows } = await db.query("select name from public.businesses where id = $1", [businessB]);
    expect(rows[0].name).toBe("Studio B");
  });

  it("A ne peut lire ni les paramètres, ni les membres, ni les adresses, ni l'abonnement de B", async () => {
    await as(db, userA, async () => {
      for (const table of ["business_settings", "business_members", "locations", "subscriptions"]) {
        const { rows } = await db.query(`select * from public.${table} where business_id = $1`, [businessB]);
        expect(rows, table).toHaveLength(0);
      }
    });
  });

  it("A ne peut pas modifier les paramètres de B", async () => {
    const count = await as(db, userA, async () =>
      (await db.query("update public.business_settings set default_appointment_minutes = 5 where business_id = $1", [businessB]))
        .rowCount,
    );
    expect(count).toBe(0);
  });

  it("A ne peut pas ajouter une adresse à B", async () => {
    await expect(
      as(db, userA, () =>
        db.query("insert into public.locations (business_id, kind, address_line1, city) values ($1, 'travel_base', 'x', 'y')", [
          businessB,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("A ne peut ni modifier ni supprimer l'adresse de B", async () => {
    await as(db, userA, async () => {
      expect((await db.query("update public.locations set city = 'Paris' where id = $1", [locationB])).rowCount).toBe(0);
      expect((await db.query("delete from public.locations where id = $1", [locationB])).rowCount).toBe(0);
    });
    const { rows } = await db.query("select city from public.locations where id = $1", [locationB]);
    expect(rows[0].city).toBe("Toulouse");
  });

  it("A ne peut pas s'ajouter comme membre de B (escalade de privilèges)", async () => {
    await expect(
      as(db, userA, () =>
        db.query("insert into public.business_members (business_id, user_id, role) values ($1, $2, 'business_owner')", [
          businessB,
          userA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("A ne peut pas lire le profil de B", async () => {
    const rows = await as(db, userA, async () =>
      (await db.query("select * from public.profiles where id = $1", [userB])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("A ne peut pas s'attribuer un abonnement ni se déclarer administrateur", async () => {
    await expect(
      as(db, userA, () => db.query("insert into public.subscriptions (business_id, status) values ($1, 'active')", [businessA])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, userA, () => db.query("insert into public.platform_admins (user_id) values ($1)", [userA])),
    ).rejects.toThrow(/permission denied/);
  });

  it("A ne peut pas modifier les colonnes protégées de sa propre entreprise", async () => {
    await expect(
      as(db, userA, () => db.query("update public.businesses set created_by = $1 where id = $2", [userB, businessA])),
    ).rejects.toThrow(/permission denied/);
  });

  it("un utilisateur sans entreprise ne voit rien", async () => {
    await as(db, outsider, async () => {
      for (const table of ["businesses", "business_members", "business_settings", "locations", "subscriptions"]) {
        expect((await db.query(`select * from public.${table}`)).rows, table).toHaveLength(0);
      }
    });
  });

  it("un visiteur non connecté n'a accès à aucune table", async () => {
    await expect(as(db, null, () => db.query("select * from public.businesses"))).rejects.toThrow(/permission denied/);
  });
});

describe("rôles", () => {
  it("le propriétaire peut modifier son entreprise", async () => {
    const count = await as(db, userA, async () =>
      (await db.query("update public.businesses set activity_mode = 'hybrid' where id = $1", [businessA])).rowCount,
    );
    expect(count).toBe(1);
  });

  it("un membre staff peut lire mais pas modifier l'entreprise", async () => {
    await as(db, staffA, async () => {
      expect((await db.query("select id from public.businesses")).rows).toEqual([{ id: businessA }]);
      expect((await db.query("update public.businesses set name = 'X' where id = $1", [businessA])).rowCount).toBe(0);
    });
  });
});

describe("stockage des logos", () => {
  const insertObject = (path: string) =>
    db.query("insert into storage.objects (bucket_id, name) values ('business-logos', $1)", [path]);

  it("A peut déposer un logo dans le dossier de son entreprise", async () => {
    await expect(as(db, userA, () => insertObject(`${businessA}/logo.png`))).resolves.toBeDefined();
  });

  it("A ne peut pas déposer un fichier dans le dossier de B", async () => {
    await expect(as(db, userA, () => insertObject(`${businessB}/logo.png`))).rejects.toThrow(/row-level security/);
  });

  it("un chemin sans identifiant d'entreprise valide est refusé", async () => {
    await expect(as(db, userA, () => insertObject("pas-un-uuid/logo.png"))).rejects.toThrow(/row-level security/);
    await expect(as(db, userA, () => insertObject("logo.png"))).rejects.toThrow(/row-level security/);
  });

  it("le staff ne peut pas remplacer le logo", async () => {
    await expect(as(db, staffA, () => insertObject(`${businessA}/logo.png`))).rejects.toThrow(/row-level security/);
  });
});

describe("contraintes", () => {
  it("refuse une devise autre que EUR", async () => {
    await expect(db.query("update public.business_settings set currency = 'USD' where business_id = $1", [businessA])).rejects.toThrow(
      /check constraint/,
    );
  });

  it("refuse un fuseau horaire inconnu", async () => {
    await expect(
      db.query("update public.business_settings set timezone = 'Mars/Olympus' where business_id = $1", [businessA]),
    ).rejects.toThrow(/Fuseau horaire invalide/);
  });

  it("refuse une étape d'onboarding hors de 1 à 5", async () => {
    await expect(db.query("update public.businesses set onboarding_step = 6 where id = $1", [businessA])).rejects.toThrow(
      /check constraint/,
    );
  });

  it("refuse une deuxième adresse du même type", async () => {
    await expect(
      db.query("insert into public.locations (business_id, kind, address_line1, city) values ($1, 'salon', 'x', 'y')", [businessB]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("la suppression d'un compte supprime ses appartenances (clé étrangère en cascade)", async () => {
    const temp = await createUser(db, "temp@example.fr");
    const biz = await createBusinessAs(temp, "Temp");
    await db.query("delete from auth.users where id = $1", [temp]);
    const { rows } = await db.query("select 1 from public.business_members where business_id = $1", [biz]);
    expect(rows).toHaveLength(0);
  });
});
