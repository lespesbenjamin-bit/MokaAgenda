import { Logo } from "@/components/layout/logo";

export default function BookingNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div>
        <h1 className="text-2xl font-bold">Réservation en ligne indisponible</h1>
        <p className="mt-2 max-w-sm text-muted-foreground">
          Cette page de réservation n&apos;existe pas ou n&apos;est pas ouverte pour le moment. Contactez directement votre professionnelle.
        </p>
      </div>
    </div>
  );
}
