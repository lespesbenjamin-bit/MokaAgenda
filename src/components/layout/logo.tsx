import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-baseline gap-1.5", className)} aria-label="Moka Réservation — accueil">
      <span className="font-display text-2xl font-semibold tracking-tight">Moka</span>
      <span className="size-1.5 translate-y-[-2px] rounded-full bg-primary" aria-hidden />
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Réservation</span>
    </Link>
  );
}
