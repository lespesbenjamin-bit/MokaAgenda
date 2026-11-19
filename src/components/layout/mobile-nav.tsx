"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import { navigation, isActivePath } from "@/config/navigation";
import { cn } from "@/lib/utils";

const primaryItems = navigation.filter((i) => i.mobilePrimary);
const moreItems = navigation.filter((i) => !i.mobilePrimary);

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = moreItems.some((i) => isActivePath(pathname, i.href));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="grid grid-cols-4">
          {primaryItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  <span className="max-w-full truncate px-1">{item.label === "Tableau de bord" ? "Accueil" : item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="mobile-more"
              className={cn(
                "flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
                moreActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <MoreHorizontal className="size-5" />
              Plus
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Plus de modules" id="mobile-more">
          <button
            type="button"
            aria-label="Fermer"
            className="absolute inset-0 bg-anthracite/30 animate-in fade-in"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-card p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl animate-in slide-in-from-bottom">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="font-display text-lg font-semibold">Modules</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-10 items-center justify-center rounded-full hover:bg-secondary"
                aria-label="Fermer"
              >
                <X className="size-5" />
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isActivePath(pathname, item.href);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-3.5 text-sm font-medium",
                        active ? "bg-accent text-accent-foreground" : "hover:bg-secondary",
                      )}
                    >
                      <Icon className="size-5 text-muted-foreground" />
                      <span className="flex-1">{item.label}</span>
                      {item.status === "coming_soon" && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          À venir
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
