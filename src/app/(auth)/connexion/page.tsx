import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/auth-forms";
import { ConfigWarning } from "@/components/auth/config-warning";
import { DemoSignIn } from "@/components/auth/demo-sign-in";
import { FormAlert } from "@/components/ui/form-alert";
import { isDemo } from "@/lib/env";
import { ROUTES, safeNextPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Connexion" };

const ERRORS: Record<string, string> = {
  lien: "Ce lien est invalide ou a expiré. Demandez-en un nouveau.",
  configuration: "Le service de connexion n'est pas configuré sur ce déploiement.",
};

export default async function LoginPage({ searchParams }: PageProps<"/connexion">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNextPath(params.next) : undefined;
  const error = typeof params.erreur === "string" ? ERRORS[params.erreur] : undefined;
  const signedOut = params.deconnecte === "1";

  return (
    <AuthCard
      title="Bon retour"
      description="Connectez-vous à votre espace professionnel."
      footer={
        <>
          Pas encore de compte ?{" "}
          <Link href={ROUTES.signup} className="font-semibold text-primary hover:underline">
            Créer un compte
          </Link>
        </>
      }
    >
      <ConfigWarning />
      {error && <div className="mb-5"><FormAlert type="error">{error}</FormAlert></div>}
      {signedOut && <div className="mb-5"><FormAlert type="success">Vous êtes déconnectée.</FormAlert></div>}
      <SignInForm next={next} />
      {isDemo && (
        <div className="mt-6 border-t border-border pt-6">
          <DemoSignIn />
        </div>
      )}
    </AuthCard>
  );
}
