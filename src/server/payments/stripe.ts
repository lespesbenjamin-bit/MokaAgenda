import "server-only";
import Stripe from "stripe";
import { headers } from "next/headers";
import { appEnv, getSiteUrl } from "@/lib/env";

/**
 * Configuration Stripe (Connect, paiements directs sur le compte de la professionnelle).
 * Clés lues côté serveur uniquement ; jamais de préfixe NEXT_PUBLIC_.
 *
 * Règles de sécurité :
 *  - en démo et en développement, seule une clé de TEST (sk_test_ / rk_test_) est acceptée ;
 *  - en production, la clé utilisée détermine le mode (test tant que tu n'as pas validé le réel).
 */
export interface StripeConfig {
  secretKey: string;
  webhookSecret: string | null;
  livemode: boolean;
}

export function readStripeConfig(env: Record<string, string | undefined> = process.env, mode = appEnv): StripeConfig | null {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key || !/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(key)) return null;
  const livemode = /^(sk|rk)_live_/.test(key);
  if (livemode && mode !== "production") return null;
  const wh = env.STRIPE_WEBHOOK_SECRET?.trim();
  return { secretKey: key, webhookSecret: wh && /^whsec_[A-Za-z0-9]{10,}$/.test(wh) ? wh : null, livemode };
}

let client: Stripe | null = null;
let clientKey = "";
export function stripeClient(cfg = readStripeConfig()): Stripe | null {
  if (!cfg) return null;
  if (!client || clientKey !== cfg.secretKey) {
    client = new Stripe(cfg.secretKey, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "Moka Réservation" } });
    clientKey = cfg.secretKey;
  }
  return client;
}

/** Pour les tests : remplace le client Stripe par un faux. */
export function setStripeClientForTests(fake: Stripe | null, key = "sk_test_fake") {
  client = fake;
  clientKey = key;
}

/** Origine du site pour les liens de retour Stripe (prévisualisation Vercel comprise). */
export async function requestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) return `${host.startsWith("localhost") ? "http" : proto}://${host}`;
  } catch {
    /* hors requête */
  }
  return getSiteUrl();
}

export const PAYMENTS_NOT_CONFIGURED = "Le paiement en ligne n'est pas encore configuré sur le serveur (clé Stripe manquante).";
export const PAYMENTS_UNAVAILABLE = "Le service de paiement est momentanément indisponible. Réessayez dans quelques minutes.";
