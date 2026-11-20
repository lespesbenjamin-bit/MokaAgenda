"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import {
  deleteAddress,
  getCustomer,
  insertAddress,
  insertCustomer,
  listAddresses,
  listIdentities,
  saveConsent,
  setPrimaryAddress,
  updateAddress,
  updateCustomer,
} from "@/server/repositories/customers";
import { addressSchema, customerSchema, preferencesSchema } from "@/lib/validation/customers";
import { DUPLICATE_REASON_LABELS, findDuplicates } from "@/lib/domain/customers";
import { toFieldErrors, withValues, type FormState } from "@/lib/validation/auth";

/**
 * Actions CRM. Client Supabase de l'utilisatrice (RLS : propriétaire et staff).
 * Une fiche n'est jamais supprimée : elle est archivée.
 */

const GENERIC: FormState = { error: "L'enregistrement a échoué. Réessayez dans un instant." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CustomerFormState extends FormState {
  duplicates?: { id: string; name: string; reasons: string }[];
}

function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

async function context() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  return { ctx, supabase, businessId: ctx.business.id };
}

const refresh = (id?: string) => {
  revalidatePath("/clientes");
  if (id) revalidatePath(`/clientes/${id}`);
};

async function checkDuplicates(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  candidate: Parameters<typeof findDuplicates>[0],
) {
  const existing = await listIdentities(supabase, businessId);
  return findDuplicates(candidate, existing).map((d) => ({
    id: d.customerId,
    name: d.name,
    reasons: d.reasons.map((r) => DUPLICATE_REASON_LABELS[r]).join(", "),
  }));
}

/** Création : doublons signalés, création possible seulement après confirmation explicite. */
export async function createCustomerAction(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const form = formObject(formData);
  const parsed = customerSchema.safeParse(form);
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const wantsAddress = Boolean(form.line1?.trim() || form.city?.trim());
  const address = wantsAddress ? addressSchema.safeParse({ kind: form.kind || "home", ...form }) : null;
  if (address && !address.success) return withValues({ fieldErrors: toFieldErrors(address.error) }, formData);

  const { supabase, businessId } = await context();
  let id: string;
  try {
    if (form.confirm_duplicate !== "on") {
      const duplicates = await checkDuplicates(supabase, businessId, parsed.data);
      if (duplicates.length) return { ...withValues({}, formData), duplicates };
    }
    id = await insertCustomer(supabase, businessId, { ...parsed.data, source: "manual" });
    if (address?.success) await insertAddress(supabase, businessId, id, address.data, true);
  } catch (error) {
    console.error("[clientes] création", error);
    return withValues(GENERIC, formData);
  }
  refresh();
  redirect(`/clientes/${id}?cree=1`);
}

export async function updateCustomerAction(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const form = formObject(formData);
  const id = form.id ?? "";
  if (!UUID.test(id)) return GENERIC;
  const parsed = customerSchema.safeParse(form);
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const { supabase, businessId } = await context();
  try {
    if (form.confirm_duplicate !== "on") {
      const duplicates = await checkDuplicates(supabase, businessId, { ...parsed.data, id });
      if (duplicates.length) return { ...withValues({}, formData), duplicates };
    }
    await updateCustomer(supabase, businessId, id, parsed.data);
  } catch (error) {
    console.error("[clientes] modification", error);
    return withValues(GENERIC, formData);
  }
  refresh(id);
  return { success: "Fiche enregistrée." };
}

export async function customerQuickAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const op = String(formData.get("op") ?? "");
  if (!UUID.test(id)) return GENERIC;
  const { supabase, businessId } = await context();
  try {
    if (op === "archive") await updateCustomer(supabase, businessId, id, { archived_at: new Date().toISOString() });
    else if (op === "restore") await updateCustomer(supabase, businessId, id, { archived_at: null });
    else return GENERIC;
  } catch (error) {
    console.error("[clientes] action", error);
    return GENERIC;
  }
  refresh(id);
  return {};
}

export async function savePreferencesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return GENERIC;
  const parsed = preferencesSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);
  const { supabase, businessId } = await context();
  try {
    await updateCustomer(supabase, businessId, id, parsed.data);
  } catch (error) {
    console.error("[clientes] préférences", error);
    return withValues(GENERIC, formData);
  }
  refresh(id);
  return { success: "Préférences enregistrées." };
}

export async function saveConsentsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return GENERIC;
  const { ctx, supabase, businessId } = await context();
  try {
    if (!(await getCustomer(supabase, businessId, id))) return { error: "Fiche introuvable." };
    for (const channel of ["email", "sms"] as const) {
      await saveConsent(supabase, businessId, id, channel, formData.get(`consent_${channel}`) === "on", ctx.userId);
    }
  } catch (error) {
    console.error("[clientes] consentements", error);
    return GENERIC;
  }
  refresh(id);
  return { success: "Consentements enregistrés." };
}

// ─── Adresses ───────────────────────────────────────────────────────

export async function saveAddressAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const form = formObject(formData);
  const customerId = form.customer_id ?? "";
  const addressId = form.address_id ?? "";
  if (!UUID.test(customerId) || (addressId && !UUID.test(addressId))) return GENERIC;
  const parsed = addressSchema.safeParse(form);
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const { supabase, businessId } = await context();
  try {
    if (!(await getCustomer(supabase, businessId, customerId))) return { error: "Fiche introuvable." };
    if (addressId) {
      await updateAddress(supabase, businessId, addressId, parsed.data);
    } else {
      const existing = await listAddresses(supabase, businessId, customerId);
      const makePrimary = existing.length === 0 || form.is_primary === "on";
      const newId = await insertAddress(supabase, businessId, customerId, parsed.data, false);
      if (makePrimary) await setPrimaryAddress(supabase, businessId, customerId, newId);
    }
  } catch (error) {
    console.error("[clientes] adresse", error);
    return withValues(GENERIC, formData);
  }
  refresh(customerId);
  return { success: addressId ? "Adresse modifiée." : "Adresse ajoutée." };
}

export async function addressQuickAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const customerId = String(formData.get("customer_id") ?? "");
  const addressId = String(formData.get("address_id") ?? "");
  const op = String(formData.get("op") ?? "");
  if (!UUID.test(customerId) || !UUID.test(addressId)) return GENERIC;
  const { supabase, businessId } = await context();
  try {
    const addresses = await listAddresses(supabase, businessId, customerId);
    const target = addresses.find((a) => a.id === addressId);
    if (!target) return { error: "Adresse introuvable." };
    if (op === "primary") await setPrimaryAddress(supabase, businessId, customerId, addressId);
    else if (op === "delete") {
      await deleteAddress(supabase, businessId, addressId);
      // Si l'adresse principale est supprimée, la suivante devient principale
      const next = addresses.find((a) => a.id !== addressId);
      if (target.is_primary && next) await setPrimaryAddress(supabase, businessId, customerId, next.id);
    } else return GENERIC;
  } catch (error) {
    console.error("[clientes] action adresse", error);
    return GENERIC;
  }
  refresh(customerId);
  return {};
}
