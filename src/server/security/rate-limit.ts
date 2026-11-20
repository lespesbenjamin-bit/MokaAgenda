import "server-only";

/**
 * Limitation de débit par adresse IP, en mémoire (meilleur effort).
 * Sur Vercel, chaque instance a sa propre mémoire : cette protection
 * freine les rafales mais n'est pas globale. Les plafonds qui font foi
 * (par entreprise et par contact) sont appliqués par la base de données.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export const LIMITS = {
  page: { max: 120, windowMs: 60_000 },
  slots: { max: 90, windowMs: 60_000 },
  booking: { max: 8, windowMs: 10 * 60_000 },
  manage: { max: 20, windowMs: 10 * 60_000 },
} as const;

export type LimitName = keyof typeof LIMITS;

export function hitRateLimit(name: LimitName, key: string, now: number = Date.now()): boolean {
  const { max, windowMs } = LIMITS[name];
  const id = `${name}:${key}`;
  const current = buckets.get(id);
  if (!current || current.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

export function resetRateLimits(): void {
  buckets.clear();
}

/** Adresse IP de la requête (en-têtes posés par Vercel). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
