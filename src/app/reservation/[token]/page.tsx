import type { Metadata } from "next";
import { ManageBookingView, Shell } from "@/components/booking/manage-booking-view";
import { mailDriver } from "@/server/notifications/mailer";
import { loadBookingByToken } from "@/server/services/public-booking";

/**
 * Confirmation et gestion d'un rendez-vous par la cliente, via le lien
 * secret reçu par email. Page jamais indexée, sans référent transmis.
 */
export const metadata: Metadata = { title: "Mon rendez-vous", robots: { index: false, follow: false } };

export default async function ManageBookingPage({ params, searchParams }: PageProps<"/reservation/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const booking = await loadBookingByToken(token);

  if (!booking) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Lien invalide</h1>
        <p className="text-muted-foreground">Ce lien de réservation n&apos;existe pas ou n&apos;est plus valide. Vérifiez l&apos;email de confirmation ou contactez votre professionnelle.</p>
      </Shell>
    );
  }

  return (
    <ManageBookingView
      booking={booking}
      token={token}
      now={new Date()}
      driver={mailDriver()}
      flags={{ confirmee: Boolean(sp.confirmee), annulee: Boolean(sp.annulee), deplacee: Boolean(sp.deplacee) }}
    />
  );
}
