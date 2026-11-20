"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isSlotError } from "@/lib/domain/public-booking";
import { isValidSlug } from "@/lib/domain/slug";
import { cancelReasonSchema, looksLikeSpam, parseBookingForm } from "@/lib/validation/public-booking";
import { clientIp, hitRateLimit } from "@/server/security/rate-limit";
import { hashIncomingToken } from "@/server/security/tokens";
import {
  cancelPublicBooking,
  createPublicBooking,
  loadBookingByHash,
  loadPublicSlots,
  reschedulePublicBooking,
  type DaySlots,
} from "@/server/services/public-booking";

/**
 * Actions publiques (sans compte). Chaque action : limitation de débit,
 * validation stricte, puis appel d'une fonction public_* de la base qui
 * refait tous les contrôles. Aucun message technique n'est renvoyé.
 */

const TOO_MANY = "Trop de demandes en peu de temps. Merci de patienter quelques minutes.";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ip() {
  return clientIp(await headers());
}

export async function publicSlotsAction(input: {
  slug: string;
  serviceId: string;
  place: string;
  fromDay: string;
  days?: number;
  token?: string;
}): Promise<{ ok: true; days: DaySlots[] } | { ok: false; message: string }> {
  if (!hitRateLimit("slots", await ip())) return { ok: false, message: TOO_MANY };
  if (!isValidSlug(input.slug) || !UUID.test(input.serviceId) || !DAY.test(input.fromDay) || (input.place !== "salon" && input.place !== "home")) {
    return { ok: false, message: "Demande invalide." };
  }
  const excludeTokenHash = input.token ? hashIncomingToken(input.token) : null;
  return loadPublicSlots({ slug: input.slug, serviceId: input.serviceId, place: input.place, fromDay: input.fromDay, days: input.days ?? 14, excludeTokenHash });
}

export interface BookingState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Le créneau n'est plus libre : l'interface revient au choix du créneau. */
  slotUnavailable?: boolean;
  success?: string;
}

export async function createPublicBookingAction(_prev: BookingState, formData: FormData): Promise<BookingState> {
  const raw = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

  // Anti-robot : champ piège invisible + délai minimal de remplissage.
  // Réponse volontairement neutre pour ne pas renseigner un robot.
  if (looksLikeSpam(raw.website, raw.rendered_at)) {
    return { error: "Merci de vérifier votre saisie puis de réessayer." };
  }
  if (!hitRateLimit("booking", await ip())) return { error: TOO_MANY };

  const parsed = parseBookingForm(raw);
  if (!parsed.ok) return { error: "Merci de corriger les champs indiqués.", fieldErrors: parsed.errors };
  const f = parsed.data;

  const result = await createPublicBooking({
    slug: f.slug,
    serviceId: f.service_id,
    place: f.place,
    startsAt: f.starts_at,
    firstName: f.first_name,
    lastName: f.last_name,
    email: f.email,
    phone: f.phone,
    address: f.place === "home" ? { line1: f.address_line1, line2: f.address_line2, postalCode: f.postal_code, city: f.city } : null,
    comment: f.comment,
    idempotencyKey: f.idempotency_key,
  });

  if (!result.ok) return { error: result.message, slotUnavailable: isSlotError(result.code) };
  if (result.duplicate || !result.token) {
    return { success: "Votre réservation est déjà enregistrée. Retrouvez sa confirmation dans votre boîte email." };
  }
  redirect(`/reservation/${result.token}?confirmee=1`);
}

export interface ManageState {
  error?: string;
  success?: string;
  slotUnavailable?: boolean;
}

export async function cancelPublicBookingAction(token: string, _prev: ManageState, formData: FormData): Promise<ManageState> {
  if (!hitRateLimit("manage", await ip())) return { error: TOO_MANY };
  const reason = cancelReasonSchema.safeParse(formData.get("reason") ?? "");
  if (!reason.success) return { error: reason.error.issues[0]?.message ?? "Motif invalide." };
  const result = await cancelPublicBooking(token, reason.data);
  if (!result.ok) return { error: result.message };
  redirect(`/reservation/${token}?annulee=1`);
}

export async function reschedulePublicBookingAction(token: string, _prev: ManageState, formData: FormData): Promise<ManageState> {
  if (!hitRateLimit("manage", await ip())) return { error: TOO_MANY };
  const startsAt = String(formData.get("starts_at") ?? "");
  if (Number.isNaN(Date.parse(startsAt))) return { error: "Choisissez un nouveau créneau." };
  const hash = hashIncomingToken(token);
  if (!hash || !(await loadBookingByHash(hash))) return { error: "Ce lien de réservation n'est pas valide." };
  const result = await reschedulePublicBooking(token, new Date(startsAt).toISOString());
  if (!result.ok) return { error: result.message, slotUnavailable: isSlotError(result.code) };
  redirect(`/reservation/${token}?deplacee=1`);
}
