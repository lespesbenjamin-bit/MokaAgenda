import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CreditCard } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { AwaitConfirmation, PaymentChoices } from "@/components/payments/payment-status";
import { isValidSlug, bookingPath } from "@/lib/domain/slug";
import { DEPOSIT_KIND_LABEL } from "@/lib/domain/public-booking";
import { formatEuros } from "@/lib/domain/pricing";
import { loadHoldStatus, loadPublicPage } from "@/server/services/public-booking";
import { readPaymentToken } from "@/server/actions/public-booking";

export const metadata: Metadata = { title: "Paiement", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Retour de Stripe Checkout. Le statut affiché vient UNIQUEMENT de la base,
 * mise à jour par le webhook Stripe : le paramètre « retour=ok » ne confirme rien.
 */
export default async function PaymentReturnPage({ params, searchParams }: PageProps<"/reserver/[slug]/paiement/[hold]">) {
  const { slug, hold } = await params;
  if (!isValidSlug(slug) || !UUID.test(hold)) notFound();
  const sp = await searchParams;
  const back = sp.retour === "ok" ? "ok" : sp.retour === "annule" ? "annule" : null;
  const token = await readPaymentToken(hold);
  const [st, page] = await Promise.all([loadHoldStatus(hold, token), loadPublicPage(slug)]);
  if (st?.status === "converted" && token) redirect(`/reservation/${token}?confirmee=1`);
  const tz = page?.settings.timezone ?? "Europe/Paris";
  const when = st ? new Intl.DateTimeFormat("fr-FR", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date(st.starts_at)) : null;
  const label = st ? DEPOSIT_KIND_LABEL[st.deposit_kind] : "Paiement";

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-10">
      <Logo />
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-primary"><CreditCard className="size-5" /></span>
          <div>
            <h1 className="text-lg font-bold">{page?.business.name ?? "Réservation"}</h1>
            {st && <p className="text-sm text-muted-foreground">{st.service_name} · {when}</p>}
          </div>
        </div>

        {!st && (
          <FormAlert type="info">
            Nous ne retrouvons pas cette demande sur cet appareil. Si vous avez payé, vous recevrez un email de confirmation dès que le paiement sera validé par Stripe.
          </FormAlert>
        )}

        {st && (
          <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">{label} à régler en ligne</dt>
            <dd className="text-right font-semibold">{formatEuros(st.deposit_cents)}</dd>
            <dt className="text-muted-foreground">Total de la prestation</dt>
            <dd className="text-right">{formatEuros(st.total_cents)}</dd>
            <dt className="text-muted-foreground">Reste à régler sur place</dt>
            <dd className="text-right">{formatEuros(st.total_cents - st.deposit_cents)}</dd>
          </dl>
        )}

        {st?.status === "open" && back === "ok" && <AwaitConfirmation />}
        {st?.status === "open" && back !== "ok" && (
          <div className="flex flex-col gap-3">
            <FormAlert type="info">Le paiement n&apos;a pas été finalisé. Le créneau reste réservé pour vous jusqu&apos;à {new Intl.DateTimeFormat("fr-FR", { timeZone: tz, timeStyle: "short" }).format(new Date(st.expires_at))}.</FormAlert>
            <PaymentChoices slug={slug} holdId={hold} />
          </div>
        )}
        {st?.status === "converted" && <FormAlert type="success">Paiement reçu et rendez-vous confirmé. Le détail vous a été envoyé par email.</FormAlert>}
        {(st?.status === "expired" || st?.status === "cancelled") && (
          <FormAlert type="info">Cette réservation temporaire n&apos;est plus active et aucun paiement n&apos;a été enregistré. Vous pouvez choisir un nouveau créneau.</FormAlert>
        )}
        {st?.status === "refund_required" && (
          <FormAlert type="error">Le créneau n&apos;était plus disponible au moment de la confirmation : aucun rendez-vous n&apos;a été créé et votre paiement est intégralement remboursé.</FormAlert>
        )}

        <Button asChild variant="outline" className="mt-5">
          <Link href={bookingPath(slug)}>Retour à la page de réservation</Link>
        </Button>
      </section>
    </main>
  );
}
