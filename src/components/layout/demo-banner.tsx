import { isDemo } from "@/lib/env";

/** Bandeau permanent affiché uniquement dans l'environnement de démonstration. */
export function DemoBanner() {
  if (!isDemo) return null;
  return (
    <div role="status" className="sticky top-0 z-50 bg-ink px-4 py-2 text-center text-xs font-semibold text-white">
      Environnement de démonstration — toutes les données sont fictives et les paiements sont en mode test.
    </div>
  );
}
