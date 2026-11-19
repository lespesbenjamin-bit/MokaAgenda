import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { ROUTES, safeNextPath } from "@/lib/routes";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Point d'arrivée des liens envoyés par email (confirmation d'inscription,
 * réinitialisation du mot de passe). Gère les deux formats Supabase :
 * - ?token_hash=...&type=...  (modèle d'email recommandé, fonctionne sur tout appareil)
 * - ?code=...                 (flux PKCE par défaut, même navigateur)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const fail = (reason: string) => {
    const url = request.nextUrl.clone();
    url.pathname = ROUTES.login;
    url.search = `?erreur=${reason}`;
    return NextResponse.redirect(url);
  };

  try {
    const supabase = await createSupabaseServerClient();
    if (tokenHash && type && OTP_TYPES.includes(type)) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (error) return fail("lien");
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return fail("lien");
    } else {
      return fail("lien");
    }
  } catch {
    return fail("configuration");
  }

  const destination = type === "recovery" ? ROUTES.resetPassword : next;
  const url = request.nextUrl.clone();
  url.pathname = destination.split("?")[0];
  url.search = destination.includes("?") ? destination.slice(destination.indexOf("?")) : "";
  return NextResponse.redirect(url);
}
