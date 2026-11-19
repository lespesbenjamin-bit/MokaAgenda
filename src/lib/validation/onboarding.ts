import { z } from "zod";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v ? v : undefined));

const phone = z
  .string()
  .trim()
  .max(30, "Numéro trop long.")
  .refine((v) => v === "" || /^\+?[0-9 .()-]{6,}$/.test(v), "Numéro de téléphone invalide.")
  .transform((v) => (v ? v : undefined));

export const ACTIVITY_MODES = ["home", "salon", "hybrid"] as const;
export type ActivityMode = (typeof ACTIVITY_MODES)[number];

export const ACTIVITY_MODE_LABELS: Record<ActivityMode, { title: string; description: string }> = {
  home: { title: "À domicile", description: "Je me déplace chez mes clientes." },
  salon: { title: "En institut", description: "Mes clientes viennent dans mon institut." },
  hybrid: { title: "Hybride", description: "Je fais les deux." },
};

export const businessInfoSchema = z.object({
  name: z.string().trim().min(1, "Indiquez le nom commercial.").max(120, "Nom trop long."),
  activity: optionalText(80, "Activité trop longue."),
  phone,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Adresse email invalide.")
    .transform((v) => (v ? v : undefined)),
});

export const activityModeSchema = z.object({
  mode: z.enum(ACTIVITY_MODES, { error: "Choisissez un mode d'activité." }),
});

const address = z.object({
  line1: z.string().trim().min(1, "Adresse requise.").max(200),
  postalCode: z.string().trim().max(12).optional(),
  city: z.string().trim().min(1, "Ville requise.").max(100),
});

export function needsSalonAddress(mode: ActivityMode): boolean {
  return mode === "salon" || mode === "hybrid";
}

export function needsTravelBase(mode: ActivityMode): boolean {
  return mode === "home" || mode === "hybrid";
}

const FIELD_SUFFIX: Record<string, string> = { line1: "line1", postalCode: "postal", city: "city" };

type Address = z.infer<typeof address>;

/** Valide l'étape 3 selon le mode d'activité choisi à l'étape 2. */
export function parseLocationForm(mode: ActivityMode, form: Record<string, string | undefined>) {
  const errors: Record<string, string> = {};

  const read = (prefix: "salon" | "travel"): Address | undefined => {
    const r = address.safeParse({
      line1: form[`${prefix}_line1`] ?? "",
      postalCode: form[`${prefix}_postal`] || undefined,
      city: form[`${prefix}_city`] ?? "",
    });
    if (r.success) return r.data;
    for (const issue of r.error.issues) {
      errors[`${prefix}_${FIELD_SUFFIX[String(issue.path[0])] ?? "line1"}`] ??= issue.message;
    }
    return undefined;
  };

  const salon = needsSalonAddress(mode) ? read("salon") : undefined;
  let travel: Address | undefined;
  if (needsTravelBase(mode)) {
    const sameAsSalon = mode === "hybrid" && form.travel_same === "on";
    travel = sameAsSalon ? salon : read("travel");
  }

  let radiusKm: number | undefined;
  if (needsTravelBase(mode) && form.radius_km) {
    const n = Number(form.radius_km);
    if (!Number.isInteger(n) || n < 0 || n > 200) errors.radius_km = "Indiquez une distance entre 0 et 200 km.";
    else radiusKm = n;
  }

  if (Object.keys(errors).length > 0) return { success: false as const, errors };
  return { success: true as const, data: { salon, travel, radiusKm } };
}

export const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180] as const;

export const TIMEZONE_OPTIONS = [
  { value: "Europe/Paris", label: "France métropolitaine (Paris)" },
  { value: "Europe/Brussels", label: "Belgique (Bruxelles)" },
  { value: "Europe/Zurich", label: "Suisse (Zurich)" },
  { value: "Europe/Luxembourg", label: "Luxembourg" },
  { value: "America/Martinique", label: "Martinique" },
  { value: "America/Guadeloupe", label: "Guadeloupe" },
  { value: "America/Cayenne", label: "Guyane" },
  { value: "Indian/Reunion", label: "La Réunion" },
  { value: "Indian/Mayotte", label: "Mayotte" },
  { value: "Pacific/Noumea", label: "Nouvelle-Calédonie" },
  { value: "Pacific/Tahiti", label: "Polynésie française" },
] as const;

export const settingsSchema = z.object({
  timezone: z.enum(TIMEZONE_OPTIONS.map((t) => t.value) as [string, ...string[]], {
    error: "Choisissez un fuseau horaire.",
  }),
  defaultDuration: z.coerce
    .number()
    .refine((n) => (DURATION_OPTIONS as readonly number[]).includes(n), "Choisissez une durée."),
});

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export function validateLogo(file: { size: number; type: string } | null): string | null {
  if (!file || file.size === 0) return null;
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) return "Format accepté : PNG, JPEG ou WebP.";
  if (file.size > LOGO_MAX_BYTES) return "Le logo ne doit pas dépasser 2 Mo.";
  return null;
}

export const ONBOARDING_STEPS = [
  { step: 1, title: "Votre entreprise" },
  { step: 2, title: "Mode d'activité" },
  { step: 3, title: "Localisation" },
  { step: 4, title: "Paramètres" },
  { step: 5, title: "Validation" },
] as const;

/**
 * Étape à afficher. On peut revenir sur une étape déjà franchie,
 * jamais sauter une étape pas encore atteinte.
 */
export function resolveOnboardingStep(savedStep: number | null, requested: string | undefined): number {
  const max = savedStep && savedStep >= 1 && savedStep <= 5 ? savedStep : 1;
  const n = Number(requested);
  if (Number.isInteger(n) && n >= 1 && n <= max) return n;
  return max;
}
