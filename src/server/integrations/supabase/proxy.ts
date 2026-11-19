import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/env";

/**
 * Rafraîchit la session Supabase à chaque requête et indique si une
 * utilisatrice est connectée (JWT vérifié par getClaims).
 */
export async function refreshSession(request: NextRequest): Promise<{
  response: NextResponse;
  isAuthenticated: boolean;
  configured: boolean;
}> {
  let response = NextResponse.next({ request });
  const config = getSupabasePublicConfig();
  if (!config) return { response, isAuthenticated: false, configured: false };

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        if (headers) for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  try {
    const { data } = await supabase.auth.getClaims();
    return { response, isAuthenticated: Boolean(data?.claims?.sub), configured: true };
  } catch {
    // Supabase injoignable : on traite comme non connectée (fail closed).
    return { response, isAuthenticated: false, configured: true };
  }
}
