/**
 * Garde-fous de la réinitialisation démo. Fonction pure (testée unitairement).
 * La réinitialisation n'est autorisée que si TOUTES les conditions sont réunies :
 * - l'application tourne en environnement « demo » ;
 * - DEMO_SUPABASE_PROJECT_REF est défini et correspond à l'URL Supabase utilisée ;
 * - l'URL ne correspond pas au projet de production (PRODUCTION_SUPABASE_PROJECT_REF).
 */
export interface DemoGuardInput {
  appEnv: string | undefined;
  supabaseUrl: string | undefined;
  demoProjectRef: string | undefined;
  productionProjectRef: string | undefined;
}

export function checkDemoTarget(input: DemoGuardInput): { ok: true } | { ok: false; reason: string } {
  if (input.appEnv !== "demo") return { ok: false, reason: "L'application n'est pas en environnement démo." };
  const demoRef = input.demoProjectRef?.trim();
  if (!demoRef) return { ok: false, reason: "DEMO_SUPABASE_PROJECT_REF n'est pas défini." };
  if (!input.supabaseUrl) return { ok: false, reason: "URL Supabase absente." };

  let host: string;
  try {
    host = new URL(input.supabaseUrl).hostname;
  } catch {
    return { ok: false, reason: "URL Supabase invalide." };
  }
  if (host.split(".")[0] !== demoRef) return { ok: false, reason: "L'URL Supabase ne correspond pas au projet démo." };

  const prodRef = input.productionProjectRef?.trim();
  if (prodRef && (prodRef === demoRef || host.split(".")[0] === prodRef)) {
    return { ok: false, reason: "Le projet ciblé est le projet de production." };
  }
  return { ok: true };
}
