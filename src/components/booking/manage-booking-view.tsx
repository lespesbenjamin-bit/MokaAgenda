import Link from "next/link";
import { CalendarCheck, CalendarX, Clock, Home, MapPin, Store } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ManageBooking } from "@/components/booking/manage-booking";
import { isDemo } from "@/lib/env";
import { canCustomerChange, changeDeadline, formatAddress } from "@/lib/domain/public-booking";
import { formatDuration, formatEuros } from "@/lib/domain/pricing";
import { addDays, localDate } from "@/lib/domain/time";
import { bookingPath } from "@/lib/domain/slug";
import type { MailDriver } from "@/server/notifications/mailer";
import type { PublicBooking } from "@/server/services/public-booking";


const STATUS: Record<string, { label: string; tone: string }> = {
  confirmed: { label: "Confirmé", tone: "bg-success-soft text-success" },
  pending: { label: "En attente de confirmation", tone: "bg-warning-soft text-warning" },
  cancelled: { label: "Annulé", tone: "bg-secondary text-muted-foreground" },
  completed: { label: "Terminé", tone: "bg-secondary text-muted-foreground" },
  no_show: { label: "Clôturé", tone: "bg-secondary text-muted-foreground" },
};

/** Détail du rendez-vous et actions de la cliente (confirmation, annulation, déplacement). */
export function ManageBookingView({
  booking,
  token,
  flags,
  now,
  driver,
}: {
  booking: PublicBooking;
  token: string;
  flags: { confirmee?: boolean; annulee?: boolean; deplacee?: boolean };
  now: Date;
  driver: MailDriver;
}) {
  const tz = booking.business.timezone;
  const start = new Date(booking.starts_at);
  const fmt = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const canCancel = canCustomerChange(booking, "cancel", now);
  const canReschedule = canCustomerChange(booking, "reschedule", now) && booking.reschedule_count < 3;
  const active = booking.status === "confirmed" || booking.status === "pending";
  const deadline = changeDeadline(start, booking.policy.cancellation_notice_hours);
  const status = STATUS[booking.status] ?? STATUS.confirmed;
  const today = localDate(now, tz);

  return (
    <Shell>
      {flags.confirmee && (
        <FormAlert type="success">
          <strong>Votre rendez-vous est confirmé.</strong>{" "}
          {isDemo || driver === "simulated"
            ? "Démonstration : la confirmation est simulée, aucun email n'a été envoyé."
            : driver === "resend"
              ? `Un email de confirmation a été envoyé à ${booking.customer.email}.`
              : "Conservez bien ce lien : il vous permet de retrouver et de gérer votre rendez-vous."}
        </FormAlert>
      )}
      {flags.annulee && <FormAlert type="success">Votre rendez-vous est annulé. La professionnelle en est informée.</FormAlert>}
      {flags.deplacee && <FormAlert type="success">Votre rendez-vous est déplacé. La professionnelle en est informée.</FormAlert>}

      <div className="flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {active ? <CalendarCheck className="size-6" /> : <CalendarX className="size-6" />}
        </span>
        <div>
          <p className="text-sm font-semibold text-primary">{booking.business.name}</p>
          <h1 className="text-xl font-bold first-letter:uppercase">{fmt.format(start)}</h1>
          <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
        </div>
      </div>

      <dl className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
        <Row label="Prestation" value={booking.items.map((i) => i.name).join(", ")} />
        <Row label="Durée" value={formatDuration(booking.duration_minutes)} icon={<Clock className="size-4" />} />
        <Row
          label="Lieu"
          icon={booking.place === "home" ? <Home className="size-4" /> : <Store className="size-4" />}
          value={booking.place === "home" ? `À domicile — ${formatAddress(booking.address)}` : `En institut${booking.salon ? ` — ${formatAddress(booking.salon)}` : ""}`}
        />
        <Row label="Prix" value={formatEuros(booking.price_total_cents)} />
        {booking.deposit_amount_cents > 0 && <Row label="Acompte" value={formatEuros(booking.deposit_amount_cents)} />}
        <Row label="Au nom de" value={`${booking.customer.first_name} ${booking.customer.last_name}`} />
        <Row label="Référence" value={booking.reference} />
      </dl>

      {booking.place === "salon" && booking.salon && (
        <a
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(booking.salon))}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MapPin className="size-4" /> Itinéraire vers l&apos;institut
        </a>
      )}

      {active && (canCancel || canReschedule) && (
        <>
          <p className="text-sm text-muted-foreground">
            Modification ou annulation en ligne possible jusqu&apos;au{" "}
            <span className="font-medium text-foreground">{new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(deadline)}</span>.
          </p>
          <ManageBooking
            token={token}
            slug={booking.business.slug}
            serviceId={booking.items[0]?.service_id ?? null}
            place={booking.place}
            timeZone={tz}
            today={today}
            lastDay={addDays(today, booking.business.booking_window_days)}
            canCancel={canCancel}
            canReschedule={canReschedule && booking.business.booking_enabled}
          />
        </>
      )}
      {active && !canCancel && !canReschedule && (
        <FormAlert type="info">
          La modification en ligne n&apos;est plus possible pour ce rendez-vous.
          {booking.business.phone ? ` Contactez ${booking.business.name} au ${booking.business.phone}.` : " Contactez directement la professionnelle."}
        </FormAlert>
      )}
      {booking.policy.cancellation_policy && <p className="whitespace-pre-line text-xs text-muted-foreground">{booking.policy.cancellation_policy}</p>}

      {!active && booking.business.booking_enabled && (
        <Button asChild>
          <Link href={bookingPath(booking.business.slug)}>Reprendre rendez-vous</Link>
        </Button>
      )}
    </Shell>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-8">
      <main className="mx-auto flex max-w-xl flex-col gap-5 rounded-2xl border border-border bg-card p-5 sm:p-7">
        {children}
      </main>
      <div className="mt-6 flex justify-center opacity-70">
        <Logo />
      </div>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="text-muted-foreground sm:w-28 sm:shrink-0">{label}</dt>
      <dd className="inline-flex items-center gap-1.5">{icon}{value}</dd>
    </div>
  );
}
