import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSiteUrl } from "@/lib/env";
import {
  publicSlots,
  requiresDeposit,
  toAvailabilityContext,
  translatePublicError,
  type PublicAvailabilityRaw,
  type PublicPage,
} from "@/lib/domain/public-booking";
import type { Place } from "@/lib/domain/pricing";
import { addDays, zonedToUtc } from "@/lib/domain/time";
import { bookingPath } from "@/lib/domain/slug";
import { createSupabasePublicClient } from "@/server/integrations/supabase/public";
import { LOGO_BUCKET } from "@/server/repositories/business";
import { SERVICE_PHOTO_BUCKET } from "@/server/repositories/catalog";
import { sendEmail } from "@/server/notifications/mailer";
import { renderEmail, type EmailBooking, type NotificationKind } from "@/server/notifications/templates";
import { generateManageToken, hashIncomingToken } from "@/server/security/tokens";
import { buildTravelFilter, travelEnabled } from "./public-travel";
import type { LatLng } from "@/lib/domain/travel";
import type { PublicPaymentInfo, PublicTravelInfo } from "@/lib/domain/public-booking";
import { readStripeConfig } from "@/server/payments/stripe";
import { decryptToken, encryptToken } from "@/server/payments/signing";
import { travelSecret } from "@/server/travel/service";

/**
 * Réservation publique côté serveur. Utilise UNIQUEMENT le client anonyme
 * et les fonctions public_* de la base (aucun accès aux tables, aucune clé
 * service_role). Les créneaux viennent du moteur de l'agenda.
 */

/** Réservation temporaire renvoyée par la base pour une prestation avec arrhes. */
export interface DepositHold {
  hold_id: string;
  deposit_cents: number;
  total_cents: number;
  travel_fee_cents: number;
  service_name: string;
  stripe_account_id: string;
  deposit_kind: "arrhes" | "acompte";
  customer_email: string;
  checkout_session_id: string | null;
  expires_at: string;
}

/** Suivi du paiement par la cliente (lien privé). */
export async function loadHoldStatus(holdId: string, token: string | null) {
  const hash = hashIncomingToken(token);
  const supabase = createSupabasePublicClient();
  if (!hash || !supabase) return null;
  const { data, error } = await supabase.rpc("public_hold_status", { p_hold: holdId, p_token_hash: hash });
  if (error || !data) return null;
  return data as { status: "open" | "converted" | "expired" | "cancelled" | "refund_required"; deposit_cents: number; total_cents: number; deposit_kind: "arrhes" | "acompte"; starts_at: string; service_name: string | null; expires_at: string; checkout_session_id: string | null; stripe_account_id: string | null; slug: string };
}

export interface PublicPageView extends PublicPage {
  logoUrl: string | null;
  coverUrl: string | null;
  photoUrls: Record<string, string>;
}

export const loadPublicPage = cache(async (slug: string): Promise<PublicPageView | null> => {
  const supabase = createSupabasePublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("public_booking_page", { p_slug: slug });
  if (error) {
    console.error("[réservation] lecture de la page", { code: error.code });
    return null;
  }
  if (!data) return null;
  const page = data as PublicPage;
  const travel = await supabase.rpc("public_travel_info", { p_slug: slug });
  page.travel = travel.error ? null : ((travel.data as PublicTravelInfo | null) ?? null);
  if (page.travel) page.travel.included_km = Number(page.travel.included_km);
  const payment = await supabase.rpc("public_payment_info", { p_slug: slug });
  page.payment = payment.error ? null : ((payment.data as PublicPaymentInfo | null) ?? null);
  if (page.payment && (!readStripeConfig() || !travelSecret())) page.payment.online = false;
  const url = (bucket: string, path: string | null) => (path ? supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : null);
  const photoUrls: Record<string, string> = {};
  for (const s of page.services) {
    const u = url(SERVICE_PHOTO_BUCKET, s.photo_path);
    if (u) photoUrls[s.id] = u;
  }
  return { ...page, logoUrl: url(LOGO_BUCKET, page.business.logo_path), coverUrl: url(LOGO_BUCKET, page.business.cover_path), photoUrls };
});

export interface DaySlots {
  day: string;
  slots: string[];
}

/** Créneaux libres sur `days` jours à partir de `fromDay`, calculés avec le moteur de l'agenda. */
export async function loadPublicSlots(input: {
  slug: string;
  serviceId: string;
  place: Place;
  fromDay: string;
  days: number;
  excludeTokenHash?: string | null;
  now?: Date;
  /** Adresse vérifiée (jeton signé) pour une prestation à domicile. */
  geo?: unknown;
  /** Coordonnées connues côté serveur (déplacement d'un rendez-vous existant). */
  coords?: LatLng | null;
}): Promise<{ ok: true; days: DaySlots[] } | { ok: false; message: string }> {
  const page = await loadPublicPage(input.slug);
  if (!page) return { ok: false, message: "La réservation en ligne n'est pas ouverte pour le moment." };
  const service = page.services.find((s) => s.id === input.serviceId);
  if (!service || !service.places.some((p) => p.place === input.place)) return { ok: false, message: "Cette prestation n'est plus réservable en ligne." };
  if (requiresDeposit(service) && !page.payment?.online) return { ok: false, message: translatePublicError("MOKA_DEPOSIT_REQUIRED").message };

  const tz = page.settings.timezone;
  const withTravel = travelEnabled(page);
  const days = Math.min(Math.max(input.days, 1), withTravel ? 7 : 31);
  const from = zonedToUtc(addDays(input.fromDay, -1), 0, tz);
  const to = zonedToUtc(addDays(input.fromDay, days + 1), 0, tz);
  const supabase = createSupabasePublicClient()!;
  const { data, error } = await supabase.rpc("public_availability", {
    p_slug: input.slug,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_exclude_token_hash: input.excludeTokenHash ?? null,
  });
  if (error || !data) return { ok: false, message: translatePublicError(error?.message).message };
  const ctx = toAvailabilityContext(data as PublicAvailabilityRaw, tz);
  const now = input.now ?? new Date();
  // Déplacements activés : seuls les créneaux compatibles avec les trajets sont proposés.
  let accept: (d: Date) => boolean = () => true;
  if (withTravel) {
    const filter = await buildTravelFilter(supabase, page, service, input.place, { geo: input.geo, coords: input.coords }, from, to);
    if (!filter.ok) return { ok: false, message: filter.message };
    accept = filter.accept;
  }
  const out: DaySlots[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(input.fromDay, i);
    const slots = publicSlots(day, service, input.place, ctx, {
      now,
      windowDays: page.settings.booking_window_days,
      stepMinutes: page.settings.slot_step_minutes,
    }).filter(accept);
    out.push({ day, slots: slots.map((d) => d.toISOString()) });
  }
  return { ok: true, days: out };
}

// ─── Rendez-vous consulté via le lien secret ────────────────────────

export interface PublicBooking {
  id: string;
  reference: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  source: "manual" | "online";
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  prep_minutes: number;
  cleanup_minutes: number;
  buffer_minutes: number;
  place: Place;
  address: { line1: string | null; line2: string | null; postal_code: string | null; city: string | null } | null;
  price_total_cents: number;
  deposit_amount_cents: number;
  comment: string | null;
  cancelled_at: string | null;
  customer: { first_name: string; last_name: string; email: string | null; phone: string | null };
  items: { service_id: string | null; name: string; duration_minutes: number; price_cents: number }[];
  min_notice_minutes: number;
  business: {
    name: string;
    slug: string;
    phone: string | null;
    email: string | null;
    booking_enabled: boolean;
    timezone: string;
    booking_window_days: number;
    slot_step_minutes: number;
  };
  salon: { line1: string; line2: string | null; postal_code: string | null; city: string } | null;
  policy: { cancellation_notice_hours: number; customer_can_cancel: boolean; customer_can_reschedule: boolean; cancellation_policy: string | null };
  reschedule_count: number;
}

export async function loadBookingCoords(hash: string): Promise<LatLng | null> {
  const supabase = createSupabasePublicClient();
  if (!supabase) return null;
  const { data } = await supabase.rpc("public_booking_coords", { p_token_hash: hash });
  const c = data as { lat: number | null; lng: number | null } | null;
  return c && c.lat != null && c.lng != null ? { lat: Number(c.lat), lng: Number(c.lng) } : null;
}

export async function loadBookingByHash(hash: string): Promise<PublicBooking | null> {
  const supabase = createSupabasePublicClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("public_get_booking", { p_token_hash: hash });
  if (error) {
    console.error("[réservation] lecture par lien", { code: error.code });
    return null;
  }
  return (data as PublicBooking | null) ?? null;
}

export async function loadBookingByToken(token: string): Promise<PublicBooking | null> {
  const hash = hashIncomingToken(token);
  return hash ? loadBookingByHash(hash) : null;
}

export function manageUrl(token: string): string {
  return `${getSiteUrl()}/reservation/${token}`;
}

// ─── Notifications ──────────────────────────────────────────────────

export interface QueuedNotification {
  id: string;
  kind: NotificationKind;
  recipient: string;
}

export function bookingToEmail(b: PublicBooking, extra: Partial<EmailBooking> = {}): EmailBooking {
  return {
    businessName: b.business.name,
    businessPhone: b.business.phone,
    businessEmail: b.business.email,
    timeZone: b.business.timezone,
    reference: b.reference,
    startsAt: new Date(b.starts_at),
    durationMinutes: b.duration_minutes,
    place: b.place,
    address: b.place === "home" ? b.address : null,
    serviceNames: b.items.map((i) => i.name),
    priceTotalCents: b.price_total_cents,
    depositCents: b.deposit_amount_cents,
    customerName: `${b.customer.first_name} ${b.customer.last_name}`.trim(),
    customerEmail: b.customer.email,
    customerPhone: b.customer.phone,
    comment: b.comment,
    cancellationPolicy: b.policy.cancellation_policy,
    cancellationNoticeHours: b.policy.customer_can_cancel || b.policy.customer_can_reschedule ? b.policy.cancellation_notice_hours : null,
    changedBy: "customer",
    ...extra,
  };
}

/**
 * Envoie les emails préparés par la base et enregistre chaque résultat.
 * Une panne d'email n'annule jamais la réservation : le statut « failed »
 * reste visible dans le journal des notifications.
 */
export async function dispatchNotifications(
  supabase: SupabaseClient,
  token: string,
  hash: string,
  notifications: QueuedNotification[],
  extra: Partial<EmailBooking> = {},
): Promise<{ status: string }[]> {
  if (notifications.length === 0) return [];
  const booking = await loadBookingByHash(hash);
  if (!booking) return [];
  const data = bookingToEmail(booking, extra);
  const site = getSiteUrl();
  const results: { status: string }[] = [];
  for (const n of notifications) {
    const forCustomer = n.kind.endsWith("_customer");
    const email = renderEmail(n.kind, data, {
      manageUrl: forCustomer && booking.status !== "cancelled" ? manageUrl(token) : null,
      agendaUrl: forCustomer ? null : `${site}/agenda/${booking.id}`,
      bookingUrl: forCustomer ? `${site}${bookingPath(booking.business.slug)}` : null,
    });
    const result = await sendEmail({
      to: n.recipient,
      ...email,
      replyTo: forCustomer ? booking.business.email : booking.customer.email,
    });
    results.push({ status: result.status });
    const { error } = await supabase.rpc("public_record_notification", {
      p_token_hash: hash,
      p_notification_id: n.id,
      p_status: result.status,
      p_provider: result.provider,
      p_message_id: result.messageId ?? null,
      p_error: result.error ?? null,
    });
    if (error) console.error("[réservation] journal des notifications", { code: error.code });
    if (result.status === "failed") console.error("[réservation] email non envoyé", { kind: n.kind, error: result.error });
  }
  return results;
}

// ─── Création, annulation, déplacement ──────────────────────────────

export type PublicActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; code: string | null; message: string; fieldErrors?: Record<string, string> };

export async function createPublicBooking(input: {
  slug: string;
  serviceId: string;
  place: Place;
  startsAt: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: { line1: string; line2: string; postalCode: string; city: string } | null;
  comment: string;
  idempotencyKey: string;
  geo?: unknown;
}): Promise<PublicActionResult<{ token: string | null; duplicate: boolean; emailStatus: string | null; payment?: DepositHold & { slug: string; businessName: string } }>> {
  const supabase = createSupabasePublicClient();
  if (!supabase) return { ok: false, code: null, message: "La réservation en ligne est momentanément indisponible." };
  // Déplacements : trajets du créneau choisi calculés et enregistrés AVANT la confirmation (vérifiés par la base).
  const page = await loadPublicPage(input.slug);
  if (page && travelEnabled(page)) {
    const service = page.services.find((s) => s.id === input.serviceId);
    if (service) {
      const startsAt = new Date(input.startsAt);
      const filter = await buildTravelFilter(supabase, page, service, input.place, { geo: input.geo }, new Date(startsAt.getTime() - 13 * 3_600_000), new Date(startsAt.getTime() + 13 * 3_600_000));
      if (!filter.ok) return { ok: false, code: "MOKA_TRAVEL_UNKNOWN", message: filter.message };
      if (!filter.accept(startsAt)) return { ok: false, ...translatePublicError("MOKA_TRAVEL_TOO_SHORT") };
    }
  }
  const generated = generateManageToken();
  let { token } = generated;
  const { hash } = generated;
  const secret = travelSecret();
  const { data, error } = await supabase.rpc("public_create_booking", {
    p: {
      slug: input.slug,
      service_id: input.serviceId,
      place: input.place,
      starts_at: input.startsAt,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      phone: input.phone,
      address_line1: input.address?.line1 ?? null,
      address_line2: input.address?.line2 ?? null,
      postal_code: input.address?.postalCode ?? null,
      city: input.address?.city ?? null,
      comment: input.comment,
      accept_terms: true,
      idempotency_key: input.idempotencyKey,
      token_hash: hash,
      geo: input.geo ?? null,
      // Lien de gestion chiffré : le webhook Stripe l'utilisera pour l'email de confirmation.
      enc_token: secret ? encryptToken(token, secret) : null,
    },
  });
  if (error || !data) {
    const t = translatePublicError(error?.message);
    if (!t.code) console.error("[réservation] création", { code: error?.code });
    return { ok: false, ...t };
  }
  const hold = data as DepositHold & { payment_required?: boolean; existing?: boolean; enc_token?: string | null };
  if (hold.payment_required) {
    // Nouvelle tentative : on reprend le lien de la première demande.
    if (hold.existing) token = (secret && hold.enc_token ? decryptToken(hold.enc_token, secret) : null) ?? "";
    const page = await loadPublicPage(input.slug);
    return { ok: true, token: token || null, duplicate: false, emailStatus: null, payment: { ...hold, slug: input.slug, businessName: page?.business.name ?? "" } };
  }
  const result = data as { appointment_id: string; duplicate: boolean; notifications: QueuedNotification[] };
  if (result.duplicate) return { ok: true, token: null, duplicate: true, emailStatus: null };
  const sent = await dispatchNotifications(supabase, token, hash, result.notifications);
  const customerStatus = sent[0]?.status ?? null;
  return { ok: true, token, duplicate: false, emailStatus: customerStatus };
}

export async function cancelPublicBooking(token: string, reason: string): Promise<PublicActionResult> {
  const supabase = createSupabasePublicClient();
  const hash = hashIncomingToken(token);
  if (!supabase || !hash) return { ok: false, ...translatePublicError("MOKA_NOT_FOUND") };
  const { data, error } = await supabase.rpc("public_cancel_booking", { p_token_hash: hash, p_reason: reason || null });
  if (error) return { ok: false, ...translatePublicError(error.message) };
  await dispatchNotifications(supabase, token, hash, (data as { notifications: QueuedNotification[] }).notifications, { changedBy: "customer" });
  return { ok: true };
}

export async function reschedulePublicBooking(token: string, startsAt: string): Promise<PublicActionResult> {
  const supabase = createSupabasePublicClient();
  const hash = hashIncomingToken(token);
  if (!supabase || !hash) return { ok: false, ...translatePublicError("MOKA_NOT_FOUND") };
  const before = await loadBookingByHash(hash);
  if (before) {
    const page = await loadPublicPage(before.business.slug);
    if (page && travelEnabled(page)) {
      const { data: c } = await supabase.rpc("public_booking_coords", { p_token_hash: hash });
      const coords = c && (c as { lat: number | null }).lat != null ? { lat: Number((c as { lat: number }).lat), lng: Number((c as { lng: number }).lng) } : null;
      const timing = { prep_minutes: before.prep_minutes, duration_minutes: before.duration_minutes, cleanup_minutes: before.cleanup_minutes, buffer_minutes: before.buffer_minutes };
      const at = new Date(startsAt);
      const filter = await buildTravelFilter(supabase, page, timing, before.place, { coords }, new Date(at.getTime() - 13 * 3_600_000), new Date(at.getTime() + 13 * 3_600_000));
      if (!filter.ok) return { ok: false, code: "MOKA_TRAVEL_UNKNOWN", message: filter.message };
      if (!filter.accept(at)) return { ok: false, ...translatePublicError("MOKA_TRAVEL_TOO_SHORT") };
    }
  }
  const { data, error } = await supabase.rpc("public_reschedule_booking", { p_token_hash: hash, p_starts_at: startsAt });
  if (error) return { ok: false, ...translatePublicError(error.message) };
  await dispatchNotifications(supabase, token, hash, (data as { notifications: QueuedNotification[] }).notifications, {
    changedBy: "customer",
    previousStartsAt: before ? new Date(before.starts_at) : null,
  });
  return { ok: true };
}
