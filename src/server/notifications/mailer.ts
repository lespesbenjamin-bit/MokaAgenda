import "server-only";
import { parseAppEnv } from "@/lib/env";

/**
 * Envoi d'emails. Trois modes, choisis automatiquement :
 *  • simulated : environnement de DÉMONSTRATION → aucun email réel, jamais ;
 *  • resend    : RESEND_API_KEY et EMAIL_FROM définis → envoi réel via Resend ;
 *  • disabled  : rien de configuré → aucun envoi, statut « skipped » enregistré.
 * Le fournisseur est isolé ici : en changer ne touche qu'à ce fichier.
 */

export type MailDriver = "simulated" | "resend" | "disabled";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
}

export interface MailResult {
  status: "sent" | "failed" | "skipped" | "simulated";
  provider: MailDriver;
  messageId?: string;
  error?: string;
}

type Env = Record<string, string | undefined>;

export function mailDriver(env: Env = process.env): MailDriver {
  if (parseAppEnv(env.NEXT_PUBLIC_APP_ENV) === "demo") return "simulated";
  if (env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim()) return "resend";
  return "disabled";
}

export async function sendEmail(message: MailMessage, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<MailResult> {
  const driver = mailDriver(env);
  if (driver === "simulated") {
    return { status: "simulated", provider: driver };
  }
  if (driver === "disabled") {
    return { status: "skipped", provider: driver, error: "Envoi d'emails non configuré (RESEND_API_KEY / EMAIL_FROM)." };
  }
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM!.trim(),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return { status: "failed", provider: driver, error: `Resend ${res.status} : ${(body.message ?? body.name ?? "erreur").slice(0, 300)}` };
    return { status: "sent", provider: driver, messageId: body.id };
  } catch (error) {
    return { status: "failed", provider: driver, error: error instanceof Error ? error.message.slice(0, 300) : "Erreur réseau" };
  }
}
