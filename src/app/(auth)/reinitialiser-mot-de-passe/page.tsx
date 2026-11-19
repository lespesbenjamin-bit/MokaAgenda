import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { FormAlert } from "@/components/ui/form-alert";
import { getCurrentUser } from "@/server/auth/session";
import { getSupabasePublicConfig } from "@/lib/env";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default async function ResetPasswordPage() {
  const user = getSupabasePublicConfig() ? await getCurrentUser() : null;
  return (
    <AuthCard title="Nouveau mot de passe" description="Choisissez le mot de passe que vous utiliserez désormais.">
      {user ? (
        <ResetPasswordForm />
      ) : (
        <div className="flex flex-col gap-4">
          <FormAlert type="error">Ce lien a expiré ou a déjà été utilisé.</FormAlert>
          <Link href={ROUTES.forgotPassword} className="text-sm font-semibold text-primary hover:underline">
            Demander un nouveau lien
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
