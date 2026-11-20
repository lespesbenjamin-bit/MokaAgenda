import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RepositoryError } from "./business";
import type { DepositType, Place, ServiceCosts, ServicePricing, ServiceTimes } from "@/lib/domain/pricing";

/**
 * Accès aux données du catalogue (catégories, prestations, tarifs par lieu, coûts).
 * Requêtes simples filtrées par business_id ; la RLS reste la garantie finale.
 */

export interface ServiceCategory {
  id: string;
  name: string;
  description: string | null;
  position: number;
  is_visible: boolean;
  archived_at: string | null;
}

export interface ServiceRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  photo_path: string | null;
  duration_minutes: number;
  prep_minutes: number;
  cleanup_minutes: number;
  buffer_minutes: number;
  min_notice_minutes: number;
  is_active: boolean;
  online_bookable: boolean;
  base_price_cents: number;
  promo_price_cents: number | null;
  extra_fee_cents: number;
  extra_fee_label: string | null;
  vat_rate_bps: number;
  deposit_type: DepositType;
  deposit_value: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Prestation complète, prête pour l'interface et les calculs. */
export interface Service extends ServiceRow {
  places: Partial<Record<Place, number | null>>;
  costs: ServiceCosts & { labels: Partial<Record<"consumables" | "products" | "other", string | null>> };
}

const SERVICE_COLUMNS =
  "id, category_id, name, description, photo_path, duration_minutes, prep_minutes, cleanup_minutes, buffer_minutes, min_notice_minutes, is_active, online_bookable, base_price_cents, promo_price_cents, extra_fee_cents, extra_fee_label, vat_rate_bps, deposit_type, deposit_value, archived_at, created_at, updated_at";

export function toPricing(s: Service): ServicePricing {
  return {
    basePriceCents: s.base_price_cents,
    promoPriceCents: s.promo_price_cents,
    extraFeeCents: s.extra_fee_cents,
    vatRateBps: s.vat_rate_bps,
    places: s.places,
    depositType: s.deposit_type,
    depositValue: s.deposit_value,
  };
}

export function toTimes(s: Service): ServiceTimes {
  return {
    durationMinutes: s.duration_minutes,
    prepMinutes: s.prep_minutes,
    cleanupMinutes: s.cleanup_minutes,
    bufferMinutes: s.buffer_minutes,
  };
}

// ─── Catégories ─────────────────────────────────────────────────────

export async function listCategories(supabase: SupabaseClient, businessId: string, { includeArchived = false } = {}) {
  let q = supabase
    .from("service_categories")
    .select("id, name, description, position, is_visible, archived_at")
    .eq("business_id", businessId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw new RepositoryError("Lecture des catégories", error);
  return (data ?? []) as ServiceCategory[];
}

export async function insertCategory(
  supabase: SupabaseClient,
  businessId: string,
  values: { name: string; description: string | null; position: number; is_visible: boolean },
) {
  const { data, error } = await supabase
    .from("service_categories")
    .insert({ business_id: businessId, ...values })
    .select("id")
    .single();
  if (error) throw new RepositoryError("Création de la catégorie", error);
  return data.id as string;
}

export async function updateCategory(
  supabase: SupabaseClient,
  businessId: string,
  id: string,
  patch: Partial<Pick<ServiceCategory, "name" | "description" | "position" | "is_visible" | "archived_at">>,
) {
  const { data, error } = await supabase
    .from("service_categories")
    .update(patch)
    .eq("business_id", businessId)
    .eq("id", id)
    .select("id");
  if (error) throw new RepositoryError("Mise à jour de la catégorie", error);
  if (!data?.length) throw new RepositoryError("Mise à jour de la catégorie", { message: "non autorisée ou introuvable" });
}

// ─── Prestations ────────────────────────────────────────────────────

async function attachDetails(supabase: SupabaseClient, businessId: string, rows: ServiceRow[]): Promise<Service[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [places, costs] = await Promise.all([
    supabase.from("service_locations").select("service_id, place, price_cents").eq("business_id", businessId).in("service_id", ids),
    supabase.from("service_costs").select("service_id, kind, label, amount_cents").eq("business_id", businessId).in("service_id", ids),
  ]);
  if (places.error) throw new RepositoryError("Lecture des tarifs par lieu", places.error);
  if (costs.error) throw new RepositoryError("Lecture des coûts", costs.error);

  return rows.map((r) => {
    const svcPlaces: Service["places"] = {};
    for (const p of places.data ?? []) if (p.service_id === r.id) svcPlaces[p.place as Place] = p.price_cents;
    const c: Service["costs"] = { consumablesCents: 0, productsCents: 0, otherCents: 0, labels: {} };
    for (const k of costs.data ?? []) {
      if (k.service_id !== r.id) continue;
      if (k.kind === "consumables") c.consumablesCents = k.amount_cents;
      if (k.kind === "products") c.productsCents = k.amount_cents;
      if (k.kind === "other") c.otherCents = k.amount_cents;
      c.labels[k.kind as "consumables" | "products" | "other"] = k.label;
    }
    return { ...r, places: svcPlaces, costs: c };
  });
}

export async function listServices(supabase: SupabaseClient, businessId: string, { includeArchived = false } = {}) {
  let q = supabase.from("services").select(SERVICE_COLUMNS).eq("business_id", businessId).order("name", { ascending: true });
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw new RepositoryError("Lecture des prestations", error);
  return attachDetails(supabase, businessId, (data ?? []) as ServiceRow[]);
}

export async function getService(supabase: SupabaseClient, businessId: string, id: string): Promise<Service | null> {
  const { data, error } = await supabase.from("services").select(SERVICE_COLUMNS).eq("business_id", businessId).eq("id", id).maybeSingle();
  if (error) throw new RepositoryError("Lecture de la prestation", error);
  if (!data) return null;
  const [svc] = await attachDetails(supabase, businessId, [data as ServiceRow]);
  return svc;
}

export type ServiceWrite = Omit<ServiceRow, "id" | "archived_at" | "created_at" | "updated_at">;

export async function insertService(supabase: SupabaseClient, businessId: string, values: ServiceWrite): Promise<string> {
  const { data, error } = await supabase
    .from("services")
    .insert({ business_id: businessId, ...values })
    .select("id")
    .single();
  if (error) throw new RepositoryError("Création de la prestation", error);
  return data.id as string;
}

export async function updateService(
  supabase: SupabaseClient,
  businessId: string,
  id: string,
  patch: Partial<ServiceWrite> & { archived_at?: string | null },
) {
  const { data, error } = await supabase.from("services").update(patch).eq("business_id", businessId).eq("id", id).select("id");
  if (error) throw new RepositoryError("Mise à jour de la prestation", error);
  if (!data?.length) throw new RepositoryError("Mise à jour de la prestation", { message: "non autorisée ou introuvable" });
}

/** Remplace les lieux proposés et leurs tarifs. */
export async function replacePlaces(
  supabase: SupabaseClient,
  businessId: string,
  serviceId: string,
  places: Partial<Record<Place, number | null>>,
) {
  const del = await supabase.from("service_locations").delete().eq("business_id", businessId).eq("service_id", serviceId);
  if (del.error) throw new RepositoryError("Mise à jour des lieux", del.error);
  const rows = (Object.entries(places) as [Place, number | null][]).map(([place, price]) => ({
    business_id: businessId,
    service_id: serviceId,
    place,
    price_cents: price,
  }));
  if (rows.length) {
    const ins = await supabase.from("service_locations").insert(rows);
    if (ins.error) throw new RepositoryError("Mise à jour des lieux", ins.error);
  }
}

/** Remplace les coûts internes (lignes à zéro non conservées). */
export async function replaceCosts(supabase: SupabaseClient, businessId: string, serviceId: string, costs: ServiceCosts) {
  const del = await supabase.from("service_costs").delete().eq("business_id", businessId).eq("service_id", serviceId);
  if (del.error) throw new RepositoryError("Mise à jour des coûts", del.error);
  const rows = [
    { kind: "consumables", amount_cents: costs.consumablesCents },
    { kind: "products", amount_cents: costs.productsCents },
    { kind: "other", amount_cents: costs.otherCents },
  ]
    .filter((r) => r.amount_cents > 0)
    .map((r) => ({ business_id: businessId, service_id: serviceId, ...r }));
  if (rows.length) {
    const ins = await supabase.from("service_costs").insert(rows);
    if (ins.error) throw new RepositoryError("Mise à jour des coûts", ins.error);
  }
}

export async function duplicateService(supabase: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await supabase.rpc("duplicate_service", { p_service_id: id });
  if (error || !data) throw new RepositoryError("Duplication de la prestation", error ?? undefined);
  return data as string;
}

export const SERVICE_PHOTO_BUCKET = "service-photos";

export async function uploadServicePhoto(supabase: SupabaseClient, businessId: string, file: File) {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${businessId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(SERVICE_PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new RepositoryError("Envoi de la photo", error);
  return path;
}

export function servicePhotoUrl(supabase: SupabaseClient, path: string | null) {
  return path ? supabase.storage.from(SERVICE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl : null;
}

/** Erreur PostgreSQL de nom en double (index unique). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /duplicate key|23505|unique/i.test(error.message);
}
