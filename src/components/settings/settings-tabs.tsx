import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/parametres", label: "Réservation en ligne" },
  { href: "/parametres/deplacements", label: "Déplacements" },
  { href: "/parametres/zones", label: "Zones" },
  { href: "/parametres/paiements", label: "Paiement en ligne" },
  { href: "/parametres/finances", label: "Finances" },
];

export function SettingsTabs({ active }: { active: string }) {
  return (
    <nav className="-mt-4 mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Sections des paramètres">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={cn("shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold", active === t.href ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
