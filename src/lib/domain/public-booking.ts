/**
 * Réservation en ligne — règles métier pures (sans accès réseau).
 * Les créneaux proposés viennent du MÊME moteur que l'agenda
 * (availability.ts) ; la base revérifie tout à la confirmation.
 */
import { freeSlots, type AvailabilityContext, type AvailabilityRule, type BlockedPeriod, type BusyPeriod } from "./availability";
import { addDays, localDate } from "./time";
import { formatEuros, type DepositType, type Place } from "./pricing";

export interface PublicService {
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
  deposit_type: DepositType;
  deposit_value: number;
  extra_fee_cents: number;
  extra_fee_label: string | null;
  places: { place: Place; price_cents: number }[];
}

export interface PublicAddress {
  line1: string;
  line2: string | null;
  postal_code: string | null;
  city: string;
}

export interface PublicPage {
  business: {
    name: string;
    slug: string;
    activity: string | null;
    activity_mode: "home" | "salon" | "hybrid" | null;
    logo_path: string | null;
    cover_path: string | null;
    description: string | null;
    phone: string | null;
    email: string | null;
    instagram: string | null;
  };
  settings: {
    timezone: string;
    booking_window_days: number;
    slot_step_minutes: number;
    cancellation_notice_hours: number;
    customer_can_cancel: boolean;
    customer_can_reschedule: boolean;
    cancellation_policy: string | null;
    booking_terms: string | null;
  };
  salon: PublicAddress | null;
  has_hours: boolean;
  categories: { id: string; name: string; description: string | null }[];
  services: PublicService[];
}

export interface PublicAvailabilityRaw {
  rules: { weekday: number; start_minute: number; end_minute: number; place: Place | null }[];
  blocks: { start: string; end: string; place: Place | null }[];
  busy: { start: string; end: string }[];
}

/** Adresse sur une ligne : « 3 rue des Pins, 31000 Toulouse ». */
export function formatAddress(a: PublicAddress | { line1: string | null; line2: string | null; postal_code: string | null; city: string | null } | null) {
  if (!a) return "";
  return [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export const PLACE_LABELS: Record<Place, string> = { salon: "En institut", home: "À domicile" };

/** Une prestation avec acompte n'est pas réservable en ligne avant l'intégration du paiement (Sprint 6). */
export function requiresDeposit(s: Pick<PublicService, "deposit_type" | "deposit_value">): boolean {
  return s.deposit_type !== "none" && s.deposit_value > 0;
}

export const DEPOSIT_UNAVAILABLE_MESSAGE =
  "Cette prestation demande un acompte : la réservation en ligne sera possible prochainement. Contactez directement la professionnelle pour la réserver.";

export function depositDescription(s: Pick<PublicService, "deposit_type" | "deposit_value">): string | null {
  if (!requiresDeposit(s)) return null;
  return s.deposit_type === "percentage" ? `Acompte de ${s.deposit_value} %` : `Acompte de ${formatEuros(s.deposit_value)}`;
}

export function priceFor(s: PublicService, place: Place): number | null {
  return s.places.find((p) => p.place === place)?.price_cents ?? null;
}

/** Prix « à partir de » pour l'affichage d'une prestation proposée dans plusieurs lieux. */
export function lowestPrice(s: PublicService): number {
  return Math.min(...s.places.map((p) => p.price_cents));
}

export function toAvailabilityContext(raw: PublicAvailabilityRaw, timeZone: string): AvailabilityContext {
  const rules: AvailabilityRule[] = raw.rules.map((r) => ({ weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute, place: r.place }));
  const blocks: BlockedPeriod[] = raw.blocks.map((b) => ({ start: new Date(b.start), end: new Date(b.end), place: b.place }));
  const busy: BusyPeriod[] = raw.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  return { timeZone, rules, blocks, busy };
}

/** Jours réservables (dates locales) : d'aujourd'hui jusqu'à l'horizon fixé par la professionnelle. */
export function bookingDays(now: Date, timeZone: string, windowDays: number): string[] {
  const first = localDate(now, timeZone);
  return Array.from({ length: windowDays + 1 }, (_, i) => addDays(first, i));
}

/**
 * Créneaux libres d'une journée pour une prestation et un lieu.
 * Respecte : horaires et pauses par lieu, congés, rendez-vous existants
 * (préparation et tampons compris), délai minimum et horizon de réservation.
 */
export function publicSlots(
  day: string,
  service: Pick<PublicService, "duration_minutes" | "prep_minutes" | "cleanup_minutes" | "buffer_minutes" | "min_notice_minutes">,
  place: Place,
  ctx: AvailabilityContext,
  { now, windowDays, stepMinutes }: { now: Date; windowDays: number; stepMinutes: number },
): Date[] {
  const notBefore = new Date(now.getTime() + service.min_notice_minutes * 60_000);
  const notAfter = new Date(now.getTime() + windowDays * 86_400_000);
  return freeSlots(
    day,
    {
      durationMinutes: service.duration_minutes,
      prepMinutes: service.prep_minutes,
      cleanupMinutes: service.cleanup_minutes,
      bufferMinutes: service.buffer_minutes,
      place,
    },
    ctx,
    { stepMinutes, notBefore },
  ).filter((d) => d <= notAfter);
}

/** Date limite pour annuler ou déplacer en ligne. */
export function changeDeadline(startsAt: Date, noticeHours: number): Date {
  return new Date(startsAt.getTime() - noticeHours * 3_600_000);
}

export function canCustomerChange(
  b: { status: string; starts_at: string; policy: { cancellation_notice_hours: number; customer_can_cancel: boolean; customer_can_reschedule: boolean } },
  action: "cancel" | "reschedule",
  now: Date = new Date(),
): boolean {
  if (b.status !== "pending" && b.status !== "confirmed") return false;
  const allowed = action === "cancel" ? b.policy.customer_can_cancel : b.policy.customer_can_reschedule;
  return allowed && now <= changeDeadline(new Date(b.starts_at), b.policy.cancellation_notice_hours);
}

/** Messages clairs pour la cliente. Aucun détail technique n'est jamais affiché. */
export const PUBLIC_ERROR_MESSAGES: Record<string, string> = {
  MOKA_BOOKING_UNAVAILABLE: "La réservation en ligne n'est pas ouverte pour le moment.",
  MOKA_SERVICE_UNAVAILABLE: "Cette prestation n'est plus réservable en ligne.",
  MOKA_DEPOSIT_REQUIRED: DEPOSIT_UNAVAILABLE_MESSAGE,
  MOKA_PLACE_UNAVAILABLE: "Cette prestation n'est pas proposée à ce lieu.",
  MOKA_TOO_LATE: "Ce créneau est trop proche : il n'est plus réservable en ligne.",
  MOKA_TOO_FAR: "Ce créneau est trop éloigné dans le temps.",
  MOKA_SLOT_TAKEN: "Ce créneau vient d'être réservé. Merci d'en choisir un autre.",
  MOKA_OUTSIDE_HOURS: "Ce créneau n'est plus disponible. Merci d'en choisir un autre.",
  MOKA_BLOCKED_PERIOD: "Ce créneau n'est plus disponible. Merci d'en choisir un autre.",
  MOKA_INVALID_ADDRESS: "Adresse incomplète : indiquez la rue, un code postal à 5 chiffres et la ville.",
  MOKA_INVALID_EMAIL: "Adresse email invalide.",
  MOKA_INVALID_PHONE: "Numéro de téléphone invalide.",
  MOKA_INVALID_NAME: "Indiquez votre prénom et votre nom.",
  MOKA_TERMS_REQUIRED: "Merci d'accepter les conditions de réservation.",
  MOKA_RATE_LIMITED: "Trop de demandes en peu de temps. Merci de réessayer plus tard ou de contacter directement la professionnelle.",
  MOKA_CHANGE_NOT_ALLOWED: "La professionnelle n'autorise pas cette modification en ligne. Contactez-la directement.",
  MOKA_CHANGE_TOO_LATE: "Le délai pour modifier ou annuler en ligne est dépassé. Contactez directement la professionnelle.",
  MOKA_APPOINTMENT_CLOSED: "Ce rendez-vous est déjà annulé ou terminé.",
  MOKA_NOT_FOUND: "Ce lien de réservation n'est pas valide.",
  MOKA_DUPLICATE: "Cette réservation a déjà été enregistrée.",
};

export const PUBLIC_GENERIC_ERROR = "Une erreur est survenue. Merci de réessayer dans un instant.";

/** Traduit une erreur technique en message pour la cliente (code MOKA_* reconnu, sinon message générique). */
export function translatePublicError(message: string | undefined | null): { code: string | null; message: string } {
  const code = message?.match(/MOKA_[A-Z_]+/)?.[0] ?? null;
  if (code && PUBLIC_ERROR_MESSAGES[code]) return { code, message: PUBLIC_ERROR_MESSAGES[code] };
  return { code: null, message: PUBLIC_GENERIC_ERROR };
}

/** Erreurs pour lesquelles il faut proposer d'autres créneaux. */
export function isSlotError(code: string | null): boolean {
  return code === "MOKA_SLOT_TAKEN" || code === "MOKA_OUTSIDE_HOURS" || code === "MOKA_BLOCKED_PERIOD" || code === "MOKA_TOO_LATE";
}
