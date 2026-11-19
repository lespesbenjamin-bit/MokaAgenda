import Link from "next/link";
import { cn } from "@/lib/utils";

export function CatalogTabs({ current }: { current: "services" | "categories" }) {
  const tabs = [
    { key: "services", label: "Prestations", href: "/prestations" },
    { key: "categories", label: "Catégories", href: "/prestations/categories" },
  ] as const;
  return (
    <nav aria-label="Catalogue" className="mb-6 flex gap-1 rounded-full bg-secondary p-1 sm:w-fit">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={cn(
            "flex-1 rounded-full px-4 py-2 text-center text-sm font-semibold transition-colors sm:flex-none",
            current === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
