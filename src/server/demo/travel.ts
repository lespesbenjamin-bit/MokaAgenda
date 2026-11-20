import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeAddress, travelSecret } from "@/server/travel/service";
import { round6 } from "@/server/travel/signing";

/**
 * Démo : localise les adresses fictives AU NIVEAU DE LA RUE uniquement
 * (numéro et mention « fictive » retirés) avec le vrai service d'adresses,
 * puis active les déplacements. Aucune coordonnée n'est inventée : une
 * adresse non trouvée reste non localisée.
 */
export function streetOnly(line1: string): string {
  return line1.replace(/\(.*?\)/g, "").replace(/^\s*\d+\s*(bis|ter)?\s*,?\s*/i, "").replace(/\s+/g, " ").trim();
}

export async function geocodeDemoBusiness(admin: SupabaseClient, businessId: string): Promise<{ located: number; failed: number; startLocated: boolean }> {
  let located = 0;
  let failed = 0;
  const cache = new Map<string, { lat: number; lng: number } | null>();
  const locate = async (line1: string, postalCode: string | null, city: string) => {
    const q = `${streetOnly(line1)}|${postalCode}|${city}`;
    if (cache.has(q)) return cache.get(q)!;
    const g = await geocodeAddress({ line1: streetOnly(line1), postalCode, city });
    const c = g.status === "ok" ? round6(g.result) : g.status === "ambiguous" ? round6(g.candidates[0]) : null;
    cache.set(q, c);
    if (c) located++;
    else failed++;
    return c;
  };

  const { data: locs } = await admin.from("locations").select("kind, address_line1, postal_code, city").eq("business_id", businessId);
  let startLocated = false;
  for (const l of locs ?? []) {
    const c = await locate(l.address_line1, l.postal_code, l.city);
    if (!c) continue;
    await admin.from("locations").update({ latitude: c.lat, longitude: c.lng, geocoded_at: new Date().toISOString(), geocode_label: `${streetOnly(l.address_line1)}, ${l.city} (démo)` }).eq("business_id", businessId).eq("kind", l.kind);
    startLocated = true;
  }

  const { data: addrs } = await admin.from("customer_addresses").select("id, line1, postal_code, city").eq("business_id", businessId);
  const coordsById = new Map<string, { lat: number; lng: number }>();
  for (const a of addrs ?? []) {
    const c = await locate(a.line1, a.postal_code, a.city);
    if (!c) continue;
    coordsById.set(a.id, c);
    await admin.from("customer_addresses").update({ latitude: c.lat, longitude: c.lng, geocoded_at: new Date().toISOString(), geocode_source: "ign" }).eq("id", a.id);
  }
  const { data: appts } = await admin.from("appointments").select("id, address_id").eq("business_id", businessId).eq("place", "home").not("address_id", "is", null);
  for (const a of appts ?? []) {
    const c = coordsById.get(a.address_id as string);
    if (c) await admin.from("appointments").update({ latitude: c.lat, longitude: c.lng }).eq("id", a.id);
  }
  return { located, failed, startLocated };
}

/** Active les déplacements fictifs si le point de départ a pu être localisé et que la clé de signature est installée. */
export async function enableDemoTravel(admin: SupabaseClient, businessId: string, settings: Record<string, unknown>, startLocated: boolean) {
  if (!startLocated || !travelSecret()) {
    console.warn("[démo] déplacements non activés : point de départ non localisé ou clé de signature absente");
    return false;
  }
  const { error } = await admin.from("travel_settings").update(settings).eq("business_id", businessId);
  if (error) throw new Error(`Déplacements démo : ${error.message}`);
  return true;
}
