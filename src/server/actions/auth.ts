"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient, SupabaseNotConfiguredError } from "@/server/integrations/supabase/server";
import { getSiteUrl, isDemo } from "@/lib/env";
import { ROUTES, safeNextPath } from "@/lib/routes";
import {
  emailOnlySchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
  toFieldErrors,
  withValues,
  translateAuthError,
  type FormState,
} from "@/lib/validation/auth";

const NOT_CONFIGURED: FormState = {
  error: "Le service de connexion n'est pas encore configuré. Contactez l'administrateur de la plateforme.",
};

function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

async function client() {
  try {
    return await createSupabaseServerClient();
  } catch (e) {
    if (e instanceof SupabaseNotConfiguredError) return null;
    throw e;
  }
}

function confirmUrl(next: string): string {
  return `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const supabase = await client();
  if (!supabase) return withValues(NOT_CONFIGURED, formData);

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: confirmUrl(ROUTES.onboarding),
      data: { full_name: parsed.data.fullName },
    },
  });
  if (error) {
    console.error("[auth] inscription", { code: error.code, status: error.status, message: error.message });
    return withValues({ error: translateAuthError(error.message, error.code) }, formData);
  }

  // Confirmation email désactivée dans Supabase : session immédiate.
  if (data.session) redirect(ROUTES.onboarding);
  redirect(`${ROUTES.verifyEmail}?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formObject(formData);
  const parsed = signInSchema.safeParse(values);
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const supabase = await client();
  if (!supabase) return withValues(NOT_CONFIGURED, formData);

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) console.error("[auth] connexion", { code: error.code, status: error.status });
  if (error) return withValues({ error: translateAuthError(error.message, error.code) }, formData);

  redirect(safeNextPath(values.next));
}

export async function signOutAction(): Promise<void> {
  const supabase = await client();
  if (supabase) await supabase.auth.signOut();
  redirect(`${ROUTES.login}?deconnecte=1`);
}

export async function requestPasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailOnlySchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const supabase = await client();
  if (!supabase) return withValues(NOT_CONFIGURED, formData);

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: confirmUrl(ROUTES.resetPassword),
  });
  // Message identique que le compte existe ou non (pas d'énumération des emails).
  if (error && (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")) {
    return withValues({ error: translateAuthError(error.message, error.code) }, formData);
  }
  return { success: "Si un compte existe avec cette adresse, un email de réinitialisation vient d'être envoyé." };
}

export async function updatePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const supabase = await client();
  if (!supabase) return withValues(NOT_CONFIGURED, formData);

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return withValues({ error: "Lien expiré. Demandez un nouvel email de réinitialisation." }, formData);

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return withValues({ error: translateAuthError(error.message, error.code) }, formData);

  redirect(`${ROUTES.dashboard}?motdepasse=1`);
}

export async function resendConfirmationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailOnlySchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const supabase = await client();
  if (!supabase) return withValues(NOT_CONFIGURED, formData);

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: confirmUrl(ROUTES.onboarding) },
  });
  if (error && (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit")) {
    return withValues({ error: translateAuthError(error.message, error.code) }, formData);
  }
  return { success: "Si l'adresse est en attente de confirmation, un nouvel email vient d'être envoyé." };
}

/** Connexion au compte de démonstration — désactivée hors environnement démo. */
export async function demoSignInAction(): Promise<FormState> {
  if (!isDemo) return { error: "La démonstration n'est pas disponible ici." };
  const email = process.env.DEMO_USER_EMAIL;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!email || !password) return { error: "Compte de démonstration non configuré." };

  const supabase = await client();
  if (!supabase) return NOT_CONFIGURED;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "La démonstration est momentanément indisponible. Réessayez dans quelques minutes." };
  redirect(ROUTES.dashboard);
}
