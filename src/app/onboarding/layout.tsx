import { Logo } from "@/components/layout/logo";
import { SignOutButton } from "@/components/layout/sign-out-button";

export default function OnboardingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Logo href="/onboarding" />
        <SignOutButton variant="ghost" size="sm" />
      </header>
      <main className="flex flex-1 justify-center px-5 pb-16 pt-2 sm:pt-6">
        <div className="w-full max-w-xl">{children}</div>
      </main>
    </div>
  );
}
