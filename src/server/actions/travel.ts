"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import {
  archiveVehicle,
  deleteArea,
  listGeoLocations,
  saveArea,
  saveVehicle,
  setLocationCoords,
  updateTravelSettings,
} from "@/server/repositories/travel";
import { geocodeAddress, travelSecret } from "@/server/travel/service";
import { round6 } from "@/server/travel/signing";
import { parseArea, parseTravelSettings, parseVehicle } from "@/lib/validation/travel";
import { withValues, type FormState } from "@/lib/validation/auth";

/** Réglages des déplacements : réservés à la propriétaire ; RLS et droits par colonne en base. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function form(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  return o;
}

async function owner() {
  const ctx = await requireBusinessContext();
  if (ctx.role !== "business_owner") return null;
  return { ctx, supabase: await createSupabaseServerClient() };
}

const refresh = () => {
  revalidatePath("/parametres", "layout");
  revalidatePath("/tournees");
};

export async function saveTravelSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: "Seule la propriétaire peut modifier ces réglages." };
  const parsed = parseTravelSettings(form(fd));
  if (!parsed.ok) return withValues({ error: "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  const d = parsed.data;
  if (d.enabled) {
    if (!travelSecret()) return withValues({ error: "Impossible d'activer : la clé de signature des trajets n'est pas encore installée sur le serveur (voir l'encadré « Configuration »)." }, fd);
    const locs = await listGeoLocations(o.supabase, o.ctx.business.id);
    const located = (k: string) => locs.some((l) => l.kind === k && l.latitude != null);
    const startKind = d.start_point;
    if (!located(startKind)) return withValues({ error: "Localisez d'abord votre point de départ (bouton « Localiser » ci-dessus)." }, fd);
    if (locs.some((l) => l.kind === "salon") && !located("salon")) return withValues({ error: "Localisez aussi l'adresse de votre institut : elle sert aux trajets institut ↔ domicile." }, fd);
  }
  try {
    await updateTravelSettings(o.supabase, o.ctx.business.id, d);
  } catch (e) {
    console.error("[déplacements] réglages", e);
    return withValues({ error: "Enregistrement impossible. Réessayez dans un instant." }, fd);
  }
  refresh();
  return { success: d.enabled ? "Enregistré. Les trajets sont pris en compte dans vos disponibilités." : "Enregistré. Les déplacements sont désactivés." };
}

export interface GeocodeLocationState {
  error?: string;
  success?: string;
  candidates?: string[];
}

/** Localise l'adresse de l'institut ou du point de départ (service d'adresses officiel). */
export async function geocodeLocationAction(kind: "salon" | "travel_base", _prev: GeocodeLocationState, fd: FormData): Promise<GeocodeLocationState> {
  const o = await owner();
  if (!o) return { error: "Action réservée à la propriétaire." };
  const loc = (await listGeoLocations(o.supabase, o.ctx.business.id)).find((l) => l.kind === kind);
  if (!loc) return { error: "Adresse introuvable : complétez-la d'abord dans l'onboarding." };
  const choice = String(fd.get("choice") ?? "").trim();
  const g = await geocodeAddress(choice ? { line1: choice } : { line1: loc.address_line1, postalCode: loc.postal_code, city: loc.city });
  if (g.status === "unavailable") return { error: g.message };
  if (g.status === "not_found") return { error: "Adresse introuvable par le service d'adresses. Vérifiez-la dans vos informations d'entreprise." };
  if (g.status === "ambiguous") return { error: "Plusieurs adresses correspondent : choisissez la bonne.", candidates: g.candidates.map((c) => c.label) };
  await setLocationCoords(o.supabase, o.ctx.business.id, kind, { ...round6(g.result), label: g.result.label });
  refresh();
  return { success: `Localisée : ${g.result.label}${g.precise ? "" : " (au niveau de la rue)"}.` };
}

export async function saveVehicleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: "Action réservée à la propriétaire." };
  const parsed = parseVehicle(form(fd));
  if (!parsed.ok) return withValues({ error: "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  const id = String(fd.get("id") ?? "");
  try {
    await saveVehicle(o.supabase, o.ctx.business.id, UUID.test(id) ? id : null, parsed.data);
  } catch (e) {
    console.error("[déplacements] véhicule", e);
    return withValues({ error: "Enregistrement impossible. Réessayez dans un instant." }, fd);
  }
  refresh();
  return { success: "Véhicule enregistré." };
}

export async function archiveVehicleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  const id = String(fd.get("id") ?? "");
  if (!o || !UUID.test(id)) return { error: "Action invalide." };
  await archiveVehicle(o.supabase, o.ctx.business.id, id);
  refresh();
  return { success: "Véhicule retiré (les rendez-vous passés gardent leur coût figé)." };
}

export async function saveAreaAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: "Action réservée à la propriétaire." };
  const parsed = parseArea(form(fd));
  if (!parsed.ok) return withValues({ error: "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  const id = String(fd.get("id") ?? "");
  try {
    await saveArea(o.supabase, o.ctx.business.id, UUID.test(id) ? id : null, parsed.data);
  } catch (e) {
    console.error("[déplacements] zone", e);
    return withValues({ error: "Enregistrement impossible. Réessayez dans un instant." }, fd);
  }
  refresh();
  return { success: "Zone enregistrée." };
}

export async function deleteAreaAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  const id = String(fd.get("id") ?? "");
  if (!o || !UUID.test(id)) return { error: "Action invalide." };
  await deleteArea(o.supabase, o.ctx.business.id, id);
  refresh();
  return { success: "Zone supprimée." };
}
