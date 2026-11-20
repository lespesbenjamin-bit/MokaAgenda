import { AtSign, Camera, Home, MapPin, Phone, Store } from "lucide-react";
import { BookingWizard, Conditions } from "@/components/booking/booking-wizard";
import { ShareLink } from "@/components/booking/share-link";
import { getSiteUrl, isDemo } from "@/lib/env";
import { addDays, localDate } from "@/lib/domain/time";
import { bookingPath } from "@/lib/domain/slug";
import { formatAddress } from "@/lib/domain/public-booking";
import type { PublicPageView } from "@/server/services/public-booking";

/** Page publique : en-tête de la professionnelle, parcours de réservation, conditions et contact. */
export function PublicBookingView({
  page,
  now,
  idempotencyKey,
  preview,
}: {
  page: PublicPageView;
  now: Date;
  idempotencyKey: string;
  preview?: React.ComponentProps<typeof BookingWizard>["preview"];
}) {
  const { business, settings } = page;
  const today = localDate(now, settings.timezone);
  const lastDay = addDays(today, settings.booking_window_days);
  const url = `${getSiteUrl()}${bookingPath(business.slug)}`;
  const modes = new Set(page.services.flatMap((s) => s.places.map((p) => p.place)));

  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="bg-card">
        <div className="relative h-36 w-full overflow-hidden bg-accent sm:h-52">
          {page.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.coverUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="mx-auto max-w-2xl px-4 pb-5 sm:px-6">
          <div className="relative z-10 -mt-10 flex items-end justify-between gap-3">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-card bg-card text-2xl font-extrabold text-primary shadow-sm">
              {page.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={page.logoUrl} alt={`Logo ${business.name}`} className="h-full w-full object-cover" />
              ) : (
                business.name.slice(0, 1).toUpperCase()
              )}
            </div>
            <ShareLink url={url} title={business.name} compact />
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{business.name}</h1>
          {business.activity && <p className="text-sm text-muted-foreground">{business.activity}</p>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {modes.has("salon") && (
              <span className="inline-flex items-center gap-1.5"><Store className="size-4" /> En institut</span>
            )}
            {modes.has("home") && (
              <span className="inline-flex items-center gap-1.5"><Home className="size-4" /> À domicile</span>
            )}
            {page.salon && modes.has("salon") && (
              <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" /> {formatAddress(page.salon)}</span>
            )}
          </div>
          {business.description && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{business.description}</p>}
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
        {isDemo && (
          <p className="rounded-xl bg-ink px-4 py-3 text-sm text-white">
            Page de démonstration : professionnelle et prestations fictives. Les réservations restent dans l&apos;environnement de démo et aucun email réel n&apos;est envoyé.
          </p>
        )}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
          <BookingWizard
            page={page}
            photoUrls={page.photoUrls}
            today={today}
            lastDay={lastDay}
            idempotencyKey={idempotencyKey}
            renderedAt={now.getTime()}
            isDemo={isDemo}
            preview={preview}
          />
        </div>

        <Conditions page={page} />

        {(business.phone || business.email || business.instagram) && (
          <section className="rounded-2xl border border-border bg-card p-4 text-sm sm:p-6">
            <h2 className="mb-3 font-bold">Contact</h2>
            <ul className="flex flex-col gap-2">
              {business.phone && (
                <li><a className="inline-flex items-center gap-2 hover:underline" href={`tel:${business.phone.replace(/\s/g, "")}`}><Phone className="size-4" /> {business.phone}</a></li>
              )}
              {business.email && (
                <li><a className="inline-flex items-center gap-2 hover:underline" href={`mailto:${business.email}`}><AtSign className="size-4" /> {business.email}</a></li>
              )}
              {business.instagram && (
                <li><a className="inline-flex items-center gap-2 hover:underline" href={`https://instagram.com/${business.instagram}`} target="_blank" rel="noopener noreferrer"><Camera className="size-4" /> @{business.instagram}</a></li>
              )}
            </ul>
          </section>
        )}

        <p className="pb-6 text-center text-xs text-muted-foreground">Réservation en ligne propulsée par Moka Réservation</p>
      </main>
    </div>
  );
}
