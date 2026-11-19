import { z } from "zod";

const email = z
  .string({ error: "Adresse email requise." })
  .trim()
  .toLowerCase()
  .min(1, "Adresse email requise.")
  .max(254, "Adresse email trop longue.")
  .pipe(z.email({ error: "Adresse email invalide." }));

export const passwordSchema = z
  .string({ error: "Mot de passe requis." })
  .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
  .max(72, "Le mot de passe ne doit pas dépasser 72 caractères.")
  .regex(/[a-zA-Z]/, "Le mot de passe doit contenir au moins une lettre.")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre.");

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Indiquez votre nom.").max(120, "Nom trop long."),
  email,
  password: passwordSchema,
  acceptTerms: z.literal("on", { error: "Vous devez accepter les conditions pour créer un compte." }),
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Mot de passe requis."),
});

export const emailOnlySchema = z.object({ email });

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Les deux mots de passe ne correspondent pas.", path: ["confirm"] });

/** État renvoyé par les Server Actions de formulaire. */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
  /** Valeurs saisies, renvoyées en cas d'erreur pour ne pas vider le formulaire (jamais les mots de passe). */
  values?: Record<string, string>;
}

const SECRET_FIELDS = new Set(["password", "confirm"]);

/** Ajoute à un état d'erreur les valeurs saisies (hors mots de passe et fichiers). */
export function withValues(state: FormState, formData: FormData): FormState {
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !SECRET_FIELDS.has(k) && !k.startsWith("$")) values[k] = v.slice(0, 500);
  }
  return { ...state, values };
}

export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** Traduit les erreurs Supabase Auth les plus courantes. */
export function translateAuthError(message: string | undefined, code?: string): string {
  const m = (message ?? "").toLowerCase();
  if (code === "email_not_confirmed" || m.includes("email not confirmed"))
    return "Votre adresse email n'est pas encore confirmée. Ouvrez le lien reçu par email.";
  if (code === "invalid_credentials" || m.includes("invalid login credentials"))
    return "Email ou mot de passe incorrect.";
  if (code === "user_already_exists" || m.includes("already registered"))
    return "Un compte existe déjà avec cette adresse email.";
  if (code === "weak_password" || m.includes("weak password") || m.includes("password should"))
    return "Ce mot de passe est trop faible. Choisissez-en un plus long ou plus varié.";
  if (code === "same_password") return "Le nouveau mot de passe doit être différent de l'ancien.";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || m.includes("rate limit"))
    return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
  return "Une erreur est survenue. Réessayez dans un instant.";
}
