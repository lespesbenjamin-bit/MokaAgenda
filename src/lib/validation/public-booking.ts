import { z } from "zod";
import { normalizePhone } from "@/lib/domain/customers";
import { isValidSlug } from "@/lib/domain/slug";
import { toFieldErrors } from "./auth";

/**
 * Validation stricte du formulaire de réservation publique.
 * La base refait les mêmes contrôles : ceci sert à afficher des messages
 * clairs avant l'envoi et à rejeter tôt les requêtes malformées.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Délai minimal entre l'affichage du formulaire et l'envoi (anti-robot). */
export const MIN_FILL_MS = 2500;

const text = (max: number, label: string) => z.string().trim().max(max, `${label} : ${max} caractères maximum.`);

export const bookingFormSchema = z
  .object({
    slug: z.string().refine(isValidSlug, "Page inconnue."),
    service_id: z.string().regex(UUID, "Choisissez une prestation."),
    place: z.enum(["salon", "home"], { error: "Choisissez un lieu." }),
    starts_at: z.iso.datetime({ offset: true, error: "Choisissez un créneau." }),
    first_name: text(80, "Prénom").min(1, "Indiquez votre prénom."),
    last_name: text(80, "Nom").min(1, "Indiquez votre nom."),
    email: z.string().trim().toLowerCase().max(254, "Adresse email trop longue.").pipe(z.email({ error: "Adresse email invalide." })),
    phone: z
      .string()
      .trim()
      .max(30, "Numéro trop long.")
      .refine((v) => {
        const n = normalizePhone(v);
        return n !== null && n.length >= 9 && n.length <= 15;
      }, "Numéro de téléphone invalide."),
    address_line1: text(200, "Adresse").optional().default(""),
    address_line2: text(200, "Complément").optional().default(""),
    postal_code: z.string().trim().max(12).optional().default(""),
    city: text(100, "Ville").optional().default(""),
    comment: text(1000, "Commentaire").optional().default(""),
    accept_terms: z.literal("on", { error: "Merci d'accepter les conditions de réservation." }),
    idempotency_key: z.string().regex(UUID, "Formulaire expiré, merci de recharger la page."),
  })
  .superRefine((v, ctx) => {
    if (v.place !== "home") return;
    if (!v.address_line1) ctx.addIssue({ code: "custom", path: ["address_line1"], message: "Indiquez votre adresse." });
    if (!/^[0-9]{5}$/.test(v.postal_code)) ctx.addIssue({ code: "custom", path: ["postal_code"], message: "Code postal à 5 chiffres." });
    if (!v.city) ctx.addIssue({ code: "custom", path: ["city"], message: "Indiquez votre ville." });
  });

export type BookingForm = z.infer<typeof bookingFormSchema>;

export function parseBookingForm(input: Record<string, unknown>): { ok: true; data: BookingForm } | { ok: false; errors: Record<string, string> } {
  const parsed = bookingFormSchema.safeParse(input);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, errors: toFieldErrors(parsed.error) };
}

/**
 * Anti-spam : champ piège invisible (rempli uniquement par les robots) et
 * délai minimal de remplissage. Renvoie true si l'envoi semble automatisé.
 */
export function looksLikeSpam(honeypot: unknown, renderedAt: unknown, now: number = Date.now()): boolean {
  if (typeof honeypot === "string" && honeypot.trim() !== "") return true;
  const t = Number(renderedAt);
  if (!Number.isFinite(t) || t <= 0) return true;
  return now - t < MIN_FILL_MS;
}

export const cancelReasonSchema = z.string().trim().max(500, "500 caractères maximum.").optional().default("");

// ─── Réglages de la page publique (professionnelle) ─────────────────

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((v) => v || null)
  .pipe(z.email({ error: "Adresse email invalide." }).nullable());

export const bookingSettingsSchema = z.object({
  booking_enabled: z.boolean(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidSlug, "3 à 50 caractères : lettres minuscules, chiffres et tirets (sans tiret au début ou à la fin)."),
  public_description: z.string().trim().max(2000, "2000 caractères maximum.").transform((v) => v || null),
  public_phone: z.string().trim().max(30, "Numéro trop long.").transform((v) => v || null),
  public_email: optionalEmail,
  public_instagram: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, "") || null)
    .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, "Identifiant Instagram invalide (sans espace).").nullable()),
  cancellation_policy: z.string().trim().max(2000, "2000 caractères maximum.").transform((v) => v || null),
  booking_terms: z.string().trim().max(10000, "10 000 caractères maximum.").transform((v) => v || null),
  cancellation_notice_hours: z.coerce.number().int("Nombre entier.").min(0, "Minimum 0.").max(720, "720 heures maximum."),
  customer_can_cancel: z.boolean(),
  customer_can_reschedule: z.boolean(),
  booking_window_days: z.coerce.number().int("Nombre entier.").min(1, "Minimum 1 jour.").max(365, "365 jours maximum."),
  slot_step_minutes: z.coerce.number().refine((v) => [5, 10, 15, 20, 30, 60].includes(v), "Pas invalide."),
  notification_email: optionalEmail,
});

export type BookingSettingsInput = z.infer<typeof bookingSettingsSchema>;
