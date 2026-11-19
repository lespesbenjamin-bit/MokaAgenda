import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { Logo } from "./logo";
import { SignOutButton } from "./sign-out-button";
import { BusinessBadge, type BusinessIdentity } from "./business-badge";

export function AppShell({ children, identity }: { children: ReactNode; identity: BusinessIdentity }) {
  const footer = (
    <div className="flex flex-col gap-2">
      <BusinessBadge identity={identity} />
      <SignOutButton variant="ghost" size="sm" className="justify-start text-muted-foreground" />
    </div>
  );
  return (
    <div className="min-h-dvh">
      <Sidebar footer={footer} />
      <header className="sticky top-0 z-30 flex h-16 items-center border-b border-border bg-background/90 px-5 backdrop-blur lg:hidden">
        <Logo href="/tableau-de-bord" />
      </header>
      <main className="pb-28 lg:pb-12 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:py-10">{children}</div>
      </main>
      <MobileNav footer={footer} />
    </div>
  );
}
