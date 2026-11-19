import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/auth-forms";
import { ConfigWarning } from "@/components/auth/config-warning";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Créer un compte" };

export default function SignUpPage() {
  return (
    <AuthCard
      title="Créer votre espace"
      description="Quelques minutes suffisent pour configurer votre activité."
      footer={
        <>
          Déjà un compte ?{" "}
          <Link href={ROUTES.login} className="font-semibold text-primary hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <ConfigWarning />
      <SignUpForm />
    </AuthCard>
  );
}
