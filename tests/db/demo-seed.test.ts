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
