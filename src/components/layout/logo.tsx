import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-baseline gap-2", className)} aria-label="Moka Réservation — accueil">
      <span className="text-2xl font-extrabold tracking-[-0.04em]">
        moka<span className="text-brand">.</span>
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Réservation</span>
    </Link>
  );
}
