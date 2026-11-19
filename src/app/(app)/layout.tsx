import { AppShell } from "@/components/layout/app-shell";
import { requireBusinessContext } from "@/server/services/business-context";
import { ACTIVITY_MODE_LABELS } from "@/lib/validation/onboarding";

/**
 * Espace professionnel : vérifie côté serveur la session (requireUser) et
 * l'entreprise de l'utilisatrice ; redirige vers l'onboarding si besoin.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireBusinessContext();
  return (
    <AppShell
      identity={{
        name: ctx.business.name,
        logoUrl: ctx.logoUrl,
        subtitle: ctx.business.activity_mode ? ACTIVITY_MODE_LABELS[ctx.business.activity_mode].title : "",
      }}
    >
      {children}
    </AppShell>
  );
}
