"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation, isActivePath } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border lg:bg-card">
      <div className="flex h-20 items-center px-6">
        <Logo href="/tableau-de-bord" />
      </div>
      <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 pb-6">
        <ul className="flex flex-col gap-1">
          {navigation.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/80 hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-[18px]", active ? "text-primary" : "text-muted-foreground")} />
                  <span className="flex-1">{item.label}</span>
                  {item.status === "coming_soon" && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                      À venir
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
