/**
 * Règles métier des fiches clientes : normalisation, affichage, doublons.
 * Fonctions pures. La normalisation est IDENTIQUE à celle de la base
 * (colonnes générées email_normalized / phone_normalized).
 */

export function normalizeEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase();
  return v || null;
}

/** Chiffres uniquement ; +33 / 0033 suivi de 9 chiffres → format national 0XXXXXXXXX. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const m = /^(?:00)?33([1-9]\d{8})$/.exec(digits);
  return m ? `0${m[1]}` : digits;
}

/** Nom comparable : minuscules, sans accents ni espaces superflus. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function displayName(c: { first_name?: string | null; last_name?: string | null }): string {
  return [c.first_name, c.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || "Sans nom";
}

export function initials(c: { first_name?: string | null; last_name?: string | null }): string {
  return ([c.first_name, c.last_name].map((s) => (s ?? "").trim()[0] ?? "").join("").toUpperCase() || "?").slice(0, 2);
}

export interface CustomerIdentity {
  id?: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
}

export type DuplicateReason = "email" | "phone" | "name_birthdate";

export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  email: "même email",
  phone: "même téléphone",
  name_birthdate: "même nom et date de naissance",
};

/**
 * Raisons pour lesquelles deux fiches semblent désigner la même personne.
 * Un simple homonyme (même nom sans autre point commun) n'est PAS un doublon.
 */
export function duplicateReasons(a: CustomerIdentity, b: CustomerIdentity): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  const ea = normalizeEmail(a.email);
  if (ea && ea === normalizeEmail(b.email)) reasons.push("email");
  const pa = normalizePhone(a.phone);
  if (pa && pa === normalizePhone(b.phone)) reasons.push("phone");
  const sameName =
    normalizeName(a.first_name) === normalizeName(b.first_name) && normalizeName(a.last_name) === normalizeName(b.last_name);
  if (sameName && a.birth_date && a.birth_date === b.birth_date) reasons.push("name_birthdate");
  return reasons;
}

export interface DuplicateMatch {
  customerId: string;
  name: string;
  reasons: DuplicateReason[];
}

export function findDuplicates(candidate: CustomerIdentity, existing: (CustomerIdentity & { id: string })[]): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const e of existing) {
    if (candidate.id && e.id === candidate.id) continue;
    const reasons = duplicateReasons(candidate, e);
    if (reasons.length) out.push({ customerId: e.id, name: displayName(e), reasons });
  }
  return out;
}

/** Clé stable d'une ligne importée (permet un import idempotent). */
export function importKeySource(c: Pick<CustomerIdentity, "first_name" | "last_name" | "email" | "phone" | "birth_date">): string {
  return [normalizeName(c.first_name), normalizeName(c.last_name), normalizeEmail(c.email) ?? "", normalizePhone(c.phone) ?? "", c.birth_date ?? ""].join("|");
}

export async function importKey(c: Pick<CustomerIdentity, "first_name" | "last_name" | "email" | "phone" | "birth_date">): Promise<string> {
  const data = new TextEncoder().encode(importKeySource(c));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const CONTACT_PREFERENCE_LABELS = {
  any: "Indifférent",
  email: "Email",
  sms: "SMS",
  phone: "Téléphone",
  none: "Ne pas contacter",
} as const;

export const ADDRESS_KIND_LABELS = { home: "Domicile", work: "Travail", other: "Autre" } as const;
