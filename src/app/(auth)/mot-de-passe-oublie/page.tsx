import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { ConfigWarning } from "@/components/auth/config-warning";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Mot de passe oublié"
      description="Indiquez votre adresse email : nous vous enverrons un lien pour choisir un nouveau mot de passe."
      footer={
        <Link href={ROUTES.login} className="font-semibold text-primary hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      <ConfigWarning />
      <ForgotPasswordForm />
    </AuthCard>
  );
}
