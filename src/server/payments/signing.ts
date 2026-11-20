import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sign } from "@/server/travel/signing";

/**
 * Opérations de paiement signées par le serveur (HMAC-SHA256, même clé que
 * les déplacements : private.app_secrets ↔ TRAVEL_SIGNING_SECRET).
 * Format IDENTIQUE à public.server_payment_op (migration Sprint 6) :
 *   pay|v1|<op>|<ts>|<payload JSON exact>
 */
export type PaymentOp =
  | "event_begin"
  | "event_finish"
  | "account_link"
  | "account_sync"
  | "checkout_attach"
  | "hold_cancel"
  | "checkout_expired"
  | "checkout_completed"
  | "payment_fee"
  | "refund_sync"
  | "dispute_sync"
  | "payout_sync";

export function paymentMessage(op: PaymentOp, ts: number, payload: string): string {
  return ["pay", "v1", op, String(ts), payload].join("|");
}

export function signedPaymentOp(op: PaymentOp, payload: Record<string, unknown>, secret: string, ts = Math.floor(Date.now() / 1000)) {
  const text = JSON.stringify(payload);
  return { p_op: op, p_payload: text, p_ts: ts, p_signature: sign(paymentMessage(op, ts, text), secret) };
}

/**
 * Chiffrement du lien de gestion de la cliente pendant le paiement :
 * le webhook Stripe (sans navigateur) doit pouvoir envoyer l'email de
 * confirmation contenant ce lien. AES-256-GCM, clé dérivée de la clé serveur.
 */
function tokenKey(secret: string): Buffer {
  return createHash("sha256").update(`moka-token-enc|v1|${secret}`).digest();
}

export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(secret), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptToken(value: string | null | undefined, secret: string): string | null {
  if (!value) return null;
  const [v, iv, tag, data] = value.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
