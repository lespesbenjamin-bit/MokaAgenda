/** Pages réservées aux utilisatrices connectées. */
export const PRIVATE_PREFIXES = [
  "/tableau-de-bord",
  "/agenda",
  "/tournees",
  "/clientes",
  "/prestations",
  "/finances",
  "/boutique",
  "/parametres",
  "/onboarding",
] as const;

/** Pages d'authentification : inutiles une fois connectée. */
export const GUEST_ONLY_PATHS = ["/connexion", "/inscription"] as const;

export const ROUTES = {
  home: "/",
  login: "/connexion",
  signup: "/inscription",
  verifyEmail: "/verifier-email",
  forgotPassword: "/mot-de-passe-oublie",
  resetPassword: "/reinitialiser-mot-de-passe",
  dashboard: "/tableau-de-bord",
  onboarding: "/onboarding",
} as const;

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((p) => matches(pathname, p));
}

export function isGuestOnlyPath(pathname: string): boolean {
  return GUEST_ONLY_PATHS.some((p) => matches(pathname, p));
}

/**
 * Valide une destination de redirection fournie par l'URL (?next=...).
 * N'accepte que les chemins internes : bloque les redirections ouvertes
 * vers un autre site (//evil.com, https://..., \\evil.com).
 */
export function safeNextPath(next: string | null | undefined, fallback: string = ROUTES.dashboard): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://moka.local");
    if (url.origin !== "http://moka.local") return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
