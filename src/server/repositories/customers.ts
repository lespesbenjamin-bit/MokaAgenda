import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RepositoryError } from "./business";
import type { CustomerIdentity } from "@/lib/domain/customers";

export type ContactPreference = "any" | "email" | "sms" | "phone" | "none";
export type AddressKind = "home" | "work" | "other";

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  notes: string | null;
  preferences: string | null;
  contact_preference: ContactPreference;
  source: "manual" | "import" | "booking";
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerAddress {
  id: string;
  customer_id: string;
  kind: AddressKind;
  label: string | null;
  line1: string;
  line2: string | null;
  postal_code: string | null;
  city: string;
  country: string;
  is_primary: boolean;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
}

export interface CustomerConsent {
  channel: "email" | "sms";
  granted: boolean;
  source: string;
  recorded_at: string;
}

const CUSTOMER_COLUMNS =
  "id, first_name, last_name, email, phone, birth_date, notes, preferences, contact_preference, source, archived_at, created_at, updated_at";
const ADDRESS_COLUMNS = "id, customer_id, kind, label, line1, line2, postal_code, city, country, is_primary, latitude, longitude, geocoded_at";

export async function listCustomers(supabase: SupabaseClient, businessId: string, { includeArchived = false, limit = 5000 } = {}) {
  let q = supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("business_id", businessId)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(limit);
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw new RepositoryError("Lecture des clientes", error);
  return (data ?? []) as Customer[];
}

/** Recherche serveur (Sprint 3 : sélection d'une cliente lors d'un rendez-vous). */
export async function searchCustomers(supabase: SupabaseClient, businessId: string, query: string, limit = 20) {
  // Seuls lettres, chiffres, espaces, @ . + - sont conservés (syntaxe de filtre PostgREST)
  const q = query.replace(/[^\p{L}\p{N}\s@.+-]/gu, "").trim().slice(0, 60);
  let req = supabase.from("customers").select(CUSTOMER_COLUMNS).eq("business_id", businessId).is("archived_at", null).limit(limit);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const parts = [`first_name.ilike.*${q}*`, `last_name.ilike.*${q}*`, `email_normalized.ilike.*${q.toLowerCase()}*`];
    if (digits.length >= 3) parts.push(`phone_normalized.ilike.*${digits}*`);
    req = req.or(parts.join(","));
  }
  const { data, error } = await req.order("last_name");
  if (error) throw new RepositoryError("Recherche de clientes", error);
  return (data ?? []) as Customer[];
}

export async function getCustomer(supabase: SupabaseClient, businessId: string, id: string) {
  const { data, error } = await supabase.from("customers").select(CUSTOMER_COLUMNS).eq("business_id", businessId).eq("id", id).maybeSingle();
  if (error) throw new RepositoryError("Lecture de la fiche cliente", error);
  return data as Customer | null;
}

/** Identités de toutes les fiches (archivées comprises) pour la détection des doublons. */
export async function listIdentities(supabase: SupabaseClient, businessId: string) {
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email, phone, birth_date, import_key")
    .eq("business_id", businessId)
    .limit(20000);
  if (error) throw new RepositoryError("Lecture des fiches", error);
  return (data ?? []) as (CustomerIdentity & { id: string; import_key: string | null })[];
}

export type CustomerWrite = Pick<Customer, "first_name" | "last_name" | "email" | "phone" | "birth_date" | "notes">;

export async function insertCustomer(
  supabase: SupabaseClient,
  businessId: string,
  values: CustomerWrite & { source?: Customer["source"]; import_key?: string | null },
) {
  const { data, error } = await supabase.from("customers").insert({ business_id: businessId, ...values }).select("id").single();
  if (error) throw new RepositoryError("Création de la fiche", error);
  return data.id as string;
}

export async function updateCustomer(
  supabase: SupabaseClient,
  businessId: string,
  id: string,
  patch: Partial<CustomerWrite & Pick<Customer, "preferences" | "contact_preference" | "archived_at">>,
) {
  const { data, error } = await supabase.from("customers").update(patch).eq("business_id", businessId).eq("id", id).select("id");
  if (error) throw new RepositoryError("Mise à jour de la fiche", error);
  if (!data?.length) throw new RepositoryError("Mise à jour de la fiche", { message: "non autorisée ou introuvable" });
}

// ─── Adresses ───────────────────────────────────────────────────────

export async function listAddresses(supabase: SupabaseClient, businessId: string, customerId: string) {
  const { data, error } = await supabase
    .from("customer_addresses")
    .select(ADDRESS_COLUMNS)
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new RepositoryError("Lecture des adresses", error);
  return (data ?? []) as CustomerAddress[];
}

export async function listPrimaryAddresses(supabase: SupabaseClient, businessId: string) {
  const { data, error } = await supabase
    .from("customer_addresses")
    .select("customer_id, city")
    .eq("business_id", businessId)
    .eq("is_primary", true)
    .limit(20000);
  if (error) throw new RepositoryError("Lecture des adresses", error);
  return (data ?? []) as { customer_id: string; city: string }[];
}

export type AddressWrite = Pick<CustomerAddress, "kind" | "label" | "line1" | "line2" | "postal_code" | "city">;

export async function insertAddress(supabase: SupabaseClient, businessId: string, customerId: string, values: AddressWrite, isPrimary: boolean) {
  const { data, error } = await supabase
    .from("customer_addresses")
    .insert({ business_id: businessId, customer_id: customerId, ...values, is_primary: isPrimary })
    .select("id")
    .single();
  if (error) throw new RepositoryError("Ajout de l'adresse", error);
  return data.id as string;
}

/** Modifier une adresse efface toute géolocalisation : elle devra être revalidée. */
export async function updateAddress(supabase: SupabaseClient, businessId: string, id: string, values: AddressWrite) {
  const { data, error } = await supabase
    .from("customer_addresses")
    .update({ ...values, latitude: null, longitude: null, geocoded_at: null, geocode_source: null })
    .eq("business_id", businessId)
    .eq("id", id)
    .select("id");
  if (error) throw new RepositoryError("Modification de l'adresse", error);
  if (!data?.length) throw new RepositoryError("Modification de l'adresse", { message: "non autorisée ou introuvable" });
}

export async function deleteAddress(supabase: SupabaseClient, businessId: string, id: string) {
  const { error } = await supabase.from("customer_addresses").delete().eq("business_id", businessId).eq("id", id);
  if (error) throw new RepositoryError("Suppression de l'adresse", error);
}

/** Définit l'adresse principale (une seule par cliente, garanti par la base). */
export async function setPrimaryAddress(supabase: SupabaseClient, businessId: string, customerId: string, addressId: string) {
  const off = await supabase
    .from("customer_addresses")
    .update({ is_primary: false })
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("is_primary", true);
  if (off.error) throw new RepositoryError("Adresse principale", off.error);
  const { data, error } = await supabase
    .from("customer_addresses")
    .update({ is_primary: true })
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("id", addressId)
    .select("id");
  if (error) throw new RepositoryError("Adresse principale", error);
  if (!data?.length) throw new RepositoryError("Adresse principale", { message: "adresse introuvable" });
}

// ─── Consentements ──────────────────────────────────────────────────

export async function listConsents(supabase: SupabaseClient, businessId: string, customerId: string) {
  const { data, error } = await supabase
    .from("customer_consents")
    .select("channel, granted, source, recorded_at")
    .eq("business_id", businessId)
    .eq("customer_id", customerId);
  if (error) throw new RepositoryError("Lecture des consentements", error);
  return (data ?? []) as CustomerConsent[];
}

export async function saveConsent(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
  channel: "email" | "sms",
  granted: boolean,
  userId: string,
) {
  const values = { granted, source: "manual", recorded_at: new Date().toISOString(), recorded_by: userId };
  const { data: existing, error } = await supabase
    .from("customer_consents")
    .select("id, granted")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("channel", channel)
    .maybeSingle();
  if (error) throw new RepositoryError("Lecture du consentement", error);
  if (existing) {
    if (existing.granted === granted) return;
    const r = await supabase.from("customer_consents").update(values).eq("id", existing.id);
    if (r.error) throw new RepositoryError("Mise à jour du consentement", r.error);
  } else {
    const r = await supabase.from("customer_consents").insert({ business_id: businessId, customer_id: customerId, channel, purpose: "marketing", ...values });
    if (r.error) throw new RepositoryError("Enregistrement du consentement", r.error);
  }
}
