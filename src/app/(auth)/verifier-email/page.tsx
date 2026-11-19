import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendConfirmationForm } from "@/components/auth/auth-forms";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Confirmez votre email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verifier-email">) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email.slice(0, 254) : undefined;
  return (
    <AuthCard
      title="Vérifiez votre boîte mail"
      description={
        <>
          Nous avons envoyé un lien de confirmation{email ? <> à <strong className="text-foreground">{email}</strong></> : null}. Cliquez
          dessus pour activer votre compte.
        </>
      }
      footer={
        <Link href={ROUTES.login} className="font-semibold text-primary hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      <div className="mb-6 flex items-center gap-3 text-sm text-muted-foreground">
        <MailCheck className="size-5 text-primary" /> Pensez à vérifier vos courriers indésirables.
      </div>
      <ResendConfirmationForm email={email} />
    </AuthCard>
  );
}
