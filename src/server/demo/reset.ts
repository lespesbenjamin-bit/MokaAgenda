import "server-only";
import { createSupabaseAdminClient } from "@/server/integrations/supabase/admin";
import { checkDemoTarget } from "./guard";
import { demoFixtures } from "./fixtures";
import { DEMO_TABLE_ORDER, buildDemoRows, buildExtraBusinessRows, buildTravelRows, rowsByTable } from "./seed";
import { enableDemoTravel, geocodeDemoBusiness } from "./travel";

/**
 * Réinitialise la base DÉMO : supprime toutes les entreprises et tous les
 * comptes, puis recrée « Moka Beauty Studio » et le compte de démonstration.
 *
 * Utilise la clé service_role (tâche d'administration, pas une action
 * utilisatrice) et refuse de s'exécuter hors du projet démo.
 */
export async function resetDemo(): Promise<{ businessId: string }> {
  const guard = checkDemoTarget({
    appEnv: process.env.NEXT_PUBLIC_APP_ENV,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    demoProjectRef: process.env.DEMO_SUPABASE_PROJECT_REF,
    productionProjectRef: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
  });
  if (!guard.ok) throw new Error(`Réinitialisation refusée : ${guard.reason}`);

  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!email || !password) throw new Error("DEMO_USER_EMAIL et DEMO_USER_PASSWORD sont requis.");

  const admin = createSupabaseAdminClient();

  // 1. Vider les données (les tables liées suivent par cascade)
  const { error: delBiz } = await admin.from("businesses").delete().not("id", "is", null);
  if (delBiz) throw new Error(`Suppression des entreprises : ${delBiz.message}`);

  // 2. Supprimer tous les comptes de la base démo
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Liste des comptes : ${error.message}`);
    if (data.users.length === 0) break;
    for (const u of data.users) {
      const { error: delUser } = await admin.auth.admin.deleteUser(u.id);
      if (delUser) throw new Error(`Suppression d'un compte : ${delUser.message}`);
    }
  }

  // 3. Recréer le compte de démonstration
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Compte démo" },
  });
  if (createErr || !created.user) throw new Error(`Création du compte démo : ${createErr?.message}`);
  const userId = created.user.id;

  // 4. Recréer l'entreprise fictive
  const f = demoFixtures;
  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .insert({ ...f.business, created_by: userId, onboarding_step: 5, onboarding_completed_at: new Date().toISOString() })
    .select("id")
    .single();
  if (bizErr || !biz) throw new Error(`Création de l'entreprise démo : ${bizErr?.message}`);

  const steps = [
    admin.from("business_members").insert({ business_id: biz.id, user_id: userId, role: "business_owner" }),
    admin.from("business_settings").insert({ business_id: biz.id, ...f.settings }),
    admin.from("locations").insert(f.locations.map((l) => ({ business_id: biz.id, ...l }))),
  ];
  for (const step of steps) {
    const { error } = await step;
    if (error) throw new Error(`Données démo : ${error.message}`);
  }

  // 5. Catalogue et clientes fictives (Sprint 2)
  const tables = rowsByTable(buildDemoRows(biz.id));
  for (const table of DEMO_TABLE_ORDER) {
    if (tables[table].length === 0) continue;
    const { error } = await admin.from(table).insert(tables[table]);
    if (error) throw new Error(`Données démo (${table}) : ${error.message}`);
  }

  // 6. Déplacements (Sprint 5) : véhicule, zones, localisation au niveau de la rue, activation
  const insertAll = async (table: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const { error } = await admin.from(table).insert(rows);
    if (error) throw new Error(`Données démo (${table}) : ${error.message}`);
  };
  const mainTravel = buildTravelRows(f.travel, biz.id);
  await insertAll("vehicles", mainTravel.vehicles);
  await insertAll("service_areas", mainTravel.service_areas);
  const geo = await geocodeDemoBusiness(admin, biz.id).catch((e) => {
    console.error("[démo] localisation", e);
    return { located: 0, failed: 0, startLocated: false };
  });
  await enableDemoTravel(admin, biz.id, f.travel.settings, geo.startLocated);

  // 7. Deux autres professionnelles fictives : 100 % domicile et 100 % institut (pages publiques)
  for (const extra of f.extra_businesses) {
    const { data: other, error } = await admin
      .from("businesses")
      .insert({ ...extra.business, created_by: userId, onboarding_step: 5, onboarding_completed_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !other) throw new Error(`Entreprise démo supplémentaire : ${error?.message}`);
    await insertAll("business_settings", [{ business_id: other.id, ...extra.settings }]);
    await insertAll("locations", extra.locations.map((l) => ({ business_id: other.id, ...l })));
    const rows = buildExtraBusinessRows(extra, other.id);
    await insertAll("services", rows.services);
    await insertAll("service_locations", rows.service_locations);
    await insertAll("availability_rules", rows.availability_rules);
    if (extra.travel) {
      const t = buildTravelRows(extra.travel, other.id);
      await insertAll("vehicles", t.vehicles);
      await insertAll("service_areas", t.service_areas);
      const g = await geocodeDemoBusiness(admin, other.id).catch(() => ({ startLocated: false }));
      await enableDemoTravel(admin, other.id, extra.travel.settings, g.startLocated);
    }
  }
  return { businessId: biz.id };
}
