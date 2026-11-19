import { AppShell } from "@/components/layout/app-shell";

/**
 * Espace professionnel.
 * La protection par session (Supabase Auth) sera branchée à l'étape 3.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
