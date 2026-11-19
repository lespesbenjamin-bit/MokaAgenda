import Link from "next/link";
import { ArrowRight, CalendarCheck, Home, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/logo";

const highlights = [
  { icon: Home, title: "À domicile", text: "Gérez vos déplacements et vos zones d'intervention." },
  { icon: Store, title: "En institut", text: "Votre cabine, votre carte de soins, vos horaires." },
  { icon: CalendarCheck, title: "Réservation confirmée", text: "Confirmation automatique, acompte si vous le souhaitez." },
];

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <Logo />
        <Button asChild variant="outline" size="sm">
          <Link href="/tableau-de-bord">Accéder à l&apos;espace pro</Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 py-16 sm:px-8">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Pour les professionnelles de la beauté
        </p>
        <h1 className="max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          Vos rendez-vous, à domicile comme en institut.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Moka Réservation réunit votre agenda, vos clientes et vos prestations dans un outil simple et élégant.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/tableau-de-bord">
              Découvrir l&apos;espace pro <ArrowRight />
            </Link>
          </Button>
        </div>

        <ul className="mt-20 grid gap-4 sm:grid-cols-3">
          {highlights.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl border border-border bg-card p-6">
              <Icon className="size-5 text-primary" />
              <p className="mt-4 font-semibold">{title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-5 py-8 text-xs text-muted-foreground sm:px-8">
        © {new Date().getFullYear()} Moka Studio
      </footer>
    </div>
  );
}
