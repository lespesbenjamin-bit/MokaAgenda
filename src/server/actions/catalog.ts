"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import {
  duplicateService,
  getService,
  insertCategory,
  insertService,
  isUniqueViolation,
  listCategories,
  replaceCosts,
  replacePlaces,
  updateCategory,
  updateService,
  uploadServicePhoto,
} from "@/server/repositories/catalog";
import { categorySchema, parseServiceForm } from "@/lib/validation/services";
import { validateLogo } from "@/lib/validation/onboarding";
import { toFieldErrors, withValues, type FormState } from "@/lib/validation/auth";

/**
 * Actions du catalogue. Toutes passent par le client Supabase de l'utilisatrice
 * (RLS : écriture réservée à la propriétaire). Aucune clé service_role.
 */

const GENERIC: FormState = { error: "L'enregistrement a échoué. Réessayez dans un instant." };
const FORBIDDEN: FormState = { error: "Seule la propriétaire de l'entreprise peut modifier le catalogue." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

async function ownerContext() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  return { ctx, supabase, isOwner: ctx.role === "business_owner", businessId: ctx.business.id };
}

function refresh() {
  revalidatePath("/prestations", "layout");
}

// ─── Catégories ─────────────────────────────────────────────────────

export async function createCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = categorySchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);
  const { supabase, isOwner, businessId } = await ownerContext();
  if (!isOwner) return FORBIDDEN;
  try {
    const existing = await listCategories(supabase, businessId);
    const position = existing.reduce((max, c) => Math.max(max, c.position), 0) + 1;
    await insertCategory(supabase, businessId, { ...parsed.data, position });
  } catch (error) {
    if (isUniqueViolation(error)) return withValues({ fieldErrors: { name: "Une catégorie porte déjà ce nom." } }, formData);
    console.error("[catalogue] création catégorie", error);
    return withValues(GENERIC, formData);
  }
  refresh();
  return { success: `Catégorie « ${parsed.data.name} » ajoutée.` };
}

export async function updateCategoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return GENERIC;
  const parsed = categorySchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);
  const { supabase, isOwner, businessId } = await ownerContext();
  if (!isOwner) return FORBIDDEN;
  try {
    await updateCategory(supabase, businessId, id, parsed.data);
  } catch (error) {
    if (isUniqueViolation(error)) return withValues({ fieldErrors: { name: "Une catégorie porte déjà ce nom." } }, formData);
    console.error("[catalogue] modification catégorie", error);
    return withValues(GENERIC, formData);
  }
  refresh();
  return { success: "Catégorie enregistrée." };
}

/** Actions rapides sur une catégorie : afficher/masquer, monter/descendre, archiver, restaurer. */
export async function categoryQuickAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const op = String(formData.get("op") ?? "");
  if (!UUID.test(id)) return GENERIC;
  const { supabase, isOwner, businessId } = await ownerContext();
  if (!isOwner) return FORBIDDEN;
  try {
    const all = await listCategories(supabase, businessId, { includeArchived: true });
    const cat = all.find((c) => c.id === id);
    if (!cat) return { error: "Catégorie introuvable." };
    if (op === "toggle") await updateCategory(supabase, businessId, id, { is_visible: !cat.is_visible });
    else if (op === "archive") await updateCategory(supabase, businessId, id, { archived_at: new Date().toISOString() });
    else if (op === "restore") await updateCategory(supabase, businessId, id, { archived_at: null });
    else if (op === "up" || op === "down") {
      const active = all.filter((c) => !c.archived_at);
      const idx = active.findIndex((c) => c.id === id);
      const swap = active[op === "up" ? idx - 1 : idx + 1];
      if (swap) {
        // Renumérote proprement puis échange les deux positions
        const order = active.map((c) => c.id);
        [order[idx], order[active.indexOf(swap)]] = [order[active.indexOf(swap)], order[idx]];
        for (let i = 0; i < order.length; i++) {
          const current = active.find((c) => c.id === order[i])!;
          if (current.position !== i + 1) await updateCategory(supabase, businessId, order[i], { position: i + 1 });
        }
      }
    } else return GENERIC;
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Une catégorie active porte déjà ce nom : renommez-la avant de restaurer." };
    console.error("[catalogue] action catégorie", error);
    return GENERIC;
  }
  refresh();
  return {};
}

// ─── Prestations ────────────────────────────────────────────────────

async function saveService(formData: FormData, id: string | null): Promise<FormState> {
  const parsed = parseServiceForm(formObject(formData));
  if (!parsed.ok) return withValues({ fieldErrors: parsed.errors, error: "Certains champs sont à corriger." }, formData);

  const photo = formData.get("photo");
  const photoFile = photo instanceof File && photo.size > 0 ? photo : null;
  const photoError = validateLogo(photoFile);
  if (photoError) return withValues({ fieldErrors: { photo: photoError } }, formData);

  const { supabase, isOwner, businessId } = await ownerContext();
  if (!isOwner) return FORBIDDEN;

  const { values, places, costs } = parsed.data;
  let serviceId = id;
  try {
    if (values.category_id) {
      const cats = await listCategories(supabase, businessId);
      if (!cats.some((c) => c.id === values.category_id)) return withValues({ fieldErrors: { category_id: "Catégorie introuvable." } }, formData);
    }
    const photoPath = photoFile ? await uploadServicePhoto(supabase, businessId, photoFile) : undefined;
    if (serviceId) {
      const existing = await getService(supabase, businessId, serviceId);
      if (!existing) return { error: "Prestation introuvable." };
      await updateService(supabase, businessId, serviceId, { ...values, ...(photoPath ? { photo_path: photoPath } : {}) });
    } else {
      serviceId = await insertService(supabase, businessId, { ...values, photo_path: photoPath ?? null });
    }
    await replacePlaces(supabase, businessId, serviceId, places);
    await replaceCosts(supabase, businessId, serviceId, costs);
  } catch (error) {
    if (isUniqueViolation(error)) return withValues({ fieldErrors: { name: "Une prestation active porte déjà ce nom." } }, formData);
    console.error("[catalogue] enregistrement prestation", error);
    return withValues(GENERIC, formData);
  }
  refresh();
  redirect(`/prestations?enregistre=${encodeURIComponent(values.name)}`);
}

export async function createServiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return saveService(formData, null);
}

export async function updateServiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return GENERIC;
  return saveService(formData, id);
}

/** Actions rapides : activer/désactiver, archiver, restaurer, dupliquer. */
export async function serviceQuickAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const op = String(formData.get("op") ?? "");
  if (!UUID.test(id)) return GENERIC;
  const { supabase, isOwner, businessId } = await ownerContext();
  if (!isOwner) return FORBIDDEN;
  let duplicatedId: string | null = null;
  try {
    const svc = await getService(supabase, businessId, id);
    if (!svc) return { error: "Prestation introuvable." };
    if (op === "toggle") await updateService(supabase, businessId, id, { is_active: !svc.is_active });
    else if (op === "archive") await updateService(supabase, businessId, id, { archived_at: new Date().toISOString(), is_active: false });
    else if (op === "restore") await updateService(supabase, businessId, id, { archived_at: null });
    else if (op === "duplicate") duplicatedId = await duplicateService(supabase, id);
    else return GENERIC;
  } catch (error) {
    unstable_rethrow(error);
    if (isUniqueViolation(error)) return { error: "Une prestation active porte déjà ce nom : renommez-la avant de restaurer." };
    console.error("[catalogue] action prestation", error);
    return GENERIC;
  }
  refresh();
  if (duplicatedId) redirect(`/prestations/${duplicatedId}?copie=1`);
  return {};
}
