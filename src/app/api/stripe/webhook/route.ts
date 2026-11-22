import { NextResponse } from "next/server";
import { handleEvent, PaymentError, verifyWebhook } from "@/server/payments/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Webhook Stripe Connect (événements des comptes connectés).
 * 1. Signature Stripe vérifiée sur le corps brut (sinon 400) ;
 * 2. idempotence par identifiant d'événement (doublons ignorés) ;
 * 3. en cas d'erreur, réponse 500 : Stripe réessaie automatiquement
 *    (c'est ainsi que sont absorbés les événements arrivés dans le désordre).
 * Aucun contenu personnel n'est journalisé.
 */
export async function POST(request: Request) {
  const body = await request.text();
  let event;
  try {
    event = verifyWebhook(body, request.headers.get("stripe-signature"));
  } catch (e) {
    const code = e instanceof PaymentError ? e.code : "BAD_SIGNATURE";
    return NextResponse.json({ error: code === "NOT_CONFIGURED" ? "Non configuré" : "Signature invalide" }, { status: code === "NOT_CONFIGURED" ? 503 : 400 });
  }
  try {
    const outcome = await handleEvent(event);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error("[stripe] webhook", { type: event.type, code: e instanceof PaymentError ? e.code : "ERROR" });
    return NextResponse.json({ error: "Traitement à reprendre" }, { status: 500 });
  }
}
