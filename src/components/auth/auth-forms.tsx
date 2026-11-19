"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  requestPasswordResetAction,
  resendConfirmationAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
} from "@/server/actions/auth";
import type { FormState } from "@/lib/validation/auth";
import { ROUTES } from "@/lib/routes";

const initial: FormState = {};

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Adresse email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <div className="flex flex-col gap-1.5">
        <Field
          label="Mot de passe"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={state.fieldErrors?.password}
        />
        <Link href={ROUTES.forgotPassword} className="self-end text-sm font-medium text-primary hover:underline">
          Mot de passe oublié ?
        </Link>
      </div>
      <SubmitButton size="lg" pendingLabel="Connexion…">
        Se connecter
      </SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <Field label="Votre nom" name="fullName" autoComplete="name" required defaultValue={state.values?.fullName} error={fe.fullName} />
      <Field label="Adresse email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} error={fe.email} />
      <Field
        label="Mot de passe"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="8 caractères minimum, avec au moins une lettre et un chiffre."
        error={fe.password}
      />
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="acceptTerms" defaultChecked={state.values?.acceptTerms === "on"} className="mt-0.5 size-4 accent-[var(--primary)]" required />
          <span>J&apos;accepte les conditions d&apos;utilisation et la politique de confidentialité de Moka Réservation.</span>
        </label>
        {fe.acceptTerms && <p className="text-xs font-medium text-destructive">{fe.acceptTerms}</p>}
      </div>
      <SubmitButton size="lg" pendingLabel="Création du compte…">
        Créer mon compte
      </SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      <Field label="Adresse email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <SubmitButton size="lg" pendingLabel="Envoi…">
        Recevoir le lien
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <Field
        label="Nouveau mot de passe"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="8 caractères minimum, avec au moins une lettre et un chiffre."
        error={state.fieldErrors?.password}
      />
      <Field label="Confirmez le mot de passe" name="confirm" type="password" autoComplete="new-password" required error={state.fieldErrors?.confirm} />
      <SubmitButton size="lg" pendingLabel="Enregistrement…">
        Enregistrer le mot de passe
      </SubmitButton>
    </form>
  );
}

export function ResendConfirmationForm({ email }: { email?: string }) {
  const [state, action] = useActionState(resendConfirmationAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      <Field label="Adresse email" name="email" type="email" defaultValue={state.values?.email ?? email} autoComplete="email" error={state.fieldErrors?.email} />
      <SubmitButton variant="outline" pendingLabel="Envoi…">
        Renvoyer l&apos;email de confirmation
      </SubmitButton>
    </form>
  );
}
