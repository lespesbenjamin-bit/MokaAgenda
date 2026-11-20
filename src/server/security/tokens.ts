import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Lien secret d'annulation / modification d'un rendez-vous.
 * 32 octets aléatoires (256 bits) ; la base ne stocke que l'empreinte SHA-256 :
 * une fuite de la base ne permet pas de reconstituer les liens.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateManageToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** Empreinte d'un jeton reçu dans l'URL, ou null s'il est malformé. */
export function hashIncomingToken(token: string | null | undefined): string | null {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  return hashToken(token);
}
