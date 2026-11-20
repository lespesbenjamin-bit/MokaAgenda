import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/server/integrations/supabase/proxy";
import { ROUTES, isGuestOnlyPath, isPrivatePath } from "@/lib/routes";

/**
 * Premier filtre (optimiste) : rafraîchit la session et redirige.
 * La vérification qui fait foi est refaite côté serveur dans chaque
 * page privée (requireUser) et par les politiques RLS en base.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { response, isAuthenticated } = await refreshSession(request);

  if (!isAuthenticated && isPrivatePath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = ROUTES.login;
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return withCookies(NextResponse.redirect(url), response);
  }

  if (isAuthenticated && isGuestOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = ROUTES.dashboard;
    url.search = "";
    return withCookies(NextResponse.redirect(url), response);
  }

  return response;
}

/** Conserve les cookies de session rafraîchis lors d'une redirection. */
function withCookies(redirect: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/demo|api/stripe|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
