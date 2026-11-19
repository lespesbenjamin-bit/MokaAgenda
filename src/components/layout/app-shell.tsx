import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { Logo } from "./logo";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Sidebar />
      {/* En-tête mobile */}
      <header className="sticky top-0 z-30 flex h-16 items-center border-b border-border bg-background/90 px-5 backdrop-blur lg:hidden">
        <Logo href="/tableau-de-bord" />
      </header>
      <main className="pb-28 lg:pb-12 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:py-10">{children}</div>
      </main>
      <MobileNav />
    </div>
  );
}
