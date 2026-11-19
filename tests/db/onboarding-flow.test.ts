/**
 * Parcours d'onboarding rejoué au niveau base : mêmes requêtes que
 * src/server/repositories/business.ts, exécutées avec le rôle `authenticated`
 * (droits par colonne + RLS), puis relecture comme après une reconnexion.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, connect, createUser } from "./helpers";

let db: Client;
let owner: string;
let businessId: string;

beforeAll(async () => {
  db = await connect();
  owner = await createUser(db, "parcours@example.fr", "Nina Parcours");
});
afterAll(async () => db?.end());

const asOwner = <T>(fn: () => Promise<T>) => as(db, owner, fn, { commit: true });

describe("parcours d'onboarding persistant", () => {
  it("étape 1 : création de l'entreprise puis ajout du logo", async () => {
    businessId = await asOwner(async () => {
      const { rows } = await db.query("select public.create_business($1, $2, $3, $4) as id", [
        "Nina Beauté",
        "Esthéticienne",
        "0611223344",
        "Contact@Nina.fr",
      ]);
      return rows[0].id as string;
    });
    await asOwner(async () => {
      await db.query("insert into storage.objects (bucket_id, name) values ('business-logos', $1)", [`${businessId}/logo-1.png`]);
      const r = await db.query("update public.businesses set logo_path = $1 where id = $2 returning id", [`${businessId}/logo-1.png`, businessId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("étape 2 : choix du mode hybride", async () => {
    const r = await asOwner(() =>
      db.query("update public.businesses set activity_mode = 'hybrid', onboarding_step = 3 where id = $1 returning id", [businessId]),
    );
    expect(r.rowCount).toBe(1);
  });

  it("étape 3 : adresses (création puis modification) et zone", async () => {
    await asOwner(async () => {
      await db.query(
        "insert into public.locations (business_id, kind, address_line1, postal_code, city) values ($1, 'salon', '5 allée Test', '31000', 'Toulouse'), ($1, 'travel_base', '5 allée Test', '31000', 'Toulouse')",
        [businessId],
      );
      const upd = await db.query(
        "update public.locations set address_line1 = '6 allée Test' where business_id = $1 and kind = 'salon' returning id",
        [businessId],
      );
      expect(upd.rowCount).toBe(1);
      const s = await db.query("update public.business_settings set service_radius_km = 25 where business_id = $1 returning business_id", [businessId]);
      expect(s.rowCount).toBe(1);
      await db.query("update public.businesses set onboarding_step = 4 where id = $1", [businessId]);
    });
  });

  it("étape 4 : paramètres", async () => {
    const r = await asOwner(() =>
      db.query(
        "update public.business_settings set timezone = 'Europe/Paris', default_appointment_minutes = 45 where business_id = $1 returning business_id",
        [businessId],
      ),
    );
    expect(r.rowCount).toBe(1);
    await asOwner(() => db.query("update public.businesses set onboarding_step = 5 where id = $1", [businessId]));
  });

  it("étape 5 : validation", async () => {
    const r = await asOwner(() =>
      db.query("update public.businesses set onboarding_completed_at = now() where id = $1 returning id", [businessId]),
    );
    expect(r.rowCount).toBe(1);
  });

  it("après reconnexion, toutes les données sont relues depuis la base", async () => {
    const data = await as(db, owner, async () => {
      const m = await db.query("select business_id, role from public.business_members where user_id = $1", [owner]);
      const b = await db.query(
        "select name, email, activity_mode, logo_path, onboarding_step, onboarding_completed_at is not null as done from public.businesses where id = $1",
        [m.rows[0].business_id],
      );
      const s = await db.query("select default_appointment_minutes, service_radius_km, currency from public.business_settings where business_id = $1", [businessId]);
      const l = await db.query("select kind, address_line1 from public.locations where business_id = $1 order by kind", [businessId]);
      return { m: m.rows, b: b.rows[0], s: s.rows[0], l: l.rows };
    });
    expect(data.m).toEqual([{ business_id: businessId, role: "business_owner" }]);
    expect(data.b).toEqual({
      name: "Nina Beauté",
      email: "contact@nina.fr",
      activity_mode: "hybrid",
      logo_path: `${businessId}/logo-1.png`,
      onboarding_step: 5,
      done: true,
    });
    expect(data.s).toEqual({ default_appointment_minutes: 45, service_radius_km: 25, currency: "EUR" });
    expect(data.l).toEqual([
      { kind: "salon", address_line1: "6 allée Test" },
      { kind: "travel_base", address_line1: "5 allée Test" },
    ]);
  });
});
