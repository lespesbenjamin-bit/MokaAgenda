import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Home, MapPin, Pencil, Store, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/layout/page-header";
import { AppointmentForm } from "@/components/agenda/appointment-form";
import { StatusActions } from "@/components/agenda/status-actions";
import { loadAppointmentFormData } from "@/server/services/agenda-page-data";
import { getAppointment, listCustomerNames, listEvents, listItems } from "@/server/repositories/agenda";
import { EVENT_LABELS, STATUS_LABELS, allowedTransitions, isEditable } from "@/lib/domain/appointments";
import { centsToInput, formatDuration, formatEuros } from "@/lib/domain/pricing";
import { localDate, localMinute, minuteToHHMM } from "@/lib/domain/time";

export const metadata: Metadata = { title: "Rendez-vous" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VARIANT = { pending: "warning", confirmed: "available", completed: "soon", cancelled: "soon", no_show: "warning" } as const;

export default async function AppointmentPage({ params, searchParams }: PageProps<"/agenda/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const data = await loadAppointmentFormData();
  const { ctx, supabase, timeZone } = data;
  const appt = await getAppointment(supabase, ctx.business.id, id);
  if (!appt) notFound();
  const [items, events, names] = await Promise.all([
    listItems(supabase, ctx.business.id, [id]),
    listEvents(supabase, ctx.business.id, id),
    listCustomerNames(supabase, ctx.business.id, [appt.customer_id]),
  ]);
  const item = items[0];
  const customerName = names.get(appt.customer_id) ?? "Cliente";
  const start = new Date(appt.starts_at);
  const end = new Date(appt.ends_at);
  const dateFmt = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" });
  const stampFmt = new Intl.DateTimeFormat("fr-FR", { timeZone, dateStyle: "short", timeStyle: "short" });
  const editing = sp.modifier === "1" && isEditable(appt.status);
  const PlaceIcon = appt.place === "home" ? Home : Store;
  const archivedService = item?.service_id && !data.services.some((s) => s.id === item.service_id);

  if (editing) {
    return (
      <>
        <PageHeader title="Modifier le rendez-vous" description={`${customerName} · ${dateFmt.format(start)}`} />
        <AppointmentForm
          services={data.services}
          customers={data.customers}
          allowedPlaces={data.allowedPlaces}
          defaults={{
            id,
            customerId: appt.customer_id,
            customerName,
            serviceId: item?.service_id ?? "",
            place: appt.place,
            date: localDate(start, timeZone),
            time: minuteToHHMM(localMinute(start, timeZone)),
            duration: String(appt.duration_minutes),
            price: item ? centsToInput(item.unit_price_cents) : "",
            addressId: appt.address_id ?? "",
            addressLine1: appt.address_line1 ?? "",
            addressLine2: appt.address_line2 ?? "",
            postalCode: appt.postal_code ?? "",
            city: appt.city ?? "",
            notes: appt.notes_internal ?? "",
          }}
        />
      </>
    );
  }

  return (
    <>
      <Link href={`/agenda?date=${localDate(start, timeZone)}`} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Agenda
      </Link>
      <PageHeader
        eyebrow={<Badge variant={STATUS_VARIANT[appt.status]} className="w-fit">{STATUS_LABELS[appt.status]}</Badge>}
        title={item?.service_name ?? "Rendez-vous"}
        description={`${dateFmt.format(start)} · ${timeFmt.format(start)} – ${timeFmt.format(end)}`}
        actions={
          isEditable(appt.status) && (
            <Button asChild variant="outline">
              <Link href={`/agenda/${id}?modifier=1`}>
                <Pencil /> Modifier ou déplacer
              </Link>
            </Button>
          )
        }
      />

      {(sp.cree === "1" || sp.modifie === "1") && (
        <div className="mb-5">
          <FormAlert type="success">{sp.cree === "1" ? "Rendez-vous créé." : "Rendez-vous modifié."}</FormAlert>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <section className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6">
            <Info icon={User} label="Cliente">
              <Link href={`/clientes/${appt.customer_id}`} className="font-semibold hover:text-primary">
                {customerName}
              </Link>
            </Info>
            <Info icon={PlaceIcon} label="Lieu">
              {appt.place === "home" ? "À domicile" : "En institut"}
            </Info>
            {appt.place === "home" && (
              <Info icon={MapPin} label="Adresse d'intervention">
                {appt.address_line1}
                {appt.address_line2 ? `, ${appt.address_line2}` : ""} — {appt.postal_code} {appt.city}
                <span className="mt-1 block text-xs text-muted-foreground">Trajet : non calculé (prochaine version)</span>
              </Info>
            )}
            <Info icon={CalendarClock} label="Temps réservé">
              {formatDuration(appt.duration_minutes)} de prestation
              {(appt.prep_minutes > 0 || appt.cleanup_minutes + appt.buffer_minutes > 0) && (
                <span className="block text-xs text-muted-foreground">
                  + {appt.prep_minutes} min de préparation, {appt.cleanup_minutes + appt.buffer_minutes} min de nettoyage et tampon
                </span>
              )}
            </Info>
          </section>

          {appt.notes_internal && (
            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <h2 className="font-display text-lg font-bold">Notes internes</h2>
              <p className="mt-2 whitespace-pre-line text-sm">{appt.notes_internal}</p>
            </section>
          )}

          {appt.status === "cancelled" && (
            <FormAlert type="info">
              Annulé le {appt.cancelled_at ? stampFmt.format(new Date(appt.cancelled_at)) : "—"}
              {appt.cancel_reason ? ` · Motif : ${appt.cancel_reason}` : ""}
            </FormAlert>
          )}

          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <h2 className="font-display text-lg font-bold">Actions</h2>
            <div className="mt-3">
              {allowedTransitions(appt.status, start).length > 0 ? (
                <StatusActions id={id} allowed={allowedTransitions(appt.status, start)} />
              ) : (
                <p className="text-sm text-muted-foreground">Ce rendez-vous est clôturé.</p>
              )}
              {appt.status === "confirmed" && start > new Date() && (
                <p className="mt-3 text-xs text-muted-foreground">« Terminé » et « Cliente absente » seront disponibles une fois l&apos;heure du rendez-vous passée.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <h2 className="font-display text-lg font-bold">Historique</h2>
            <ol className="mt-3 flex flex-col gap-3 border-l border-border pl-4">
              {events.map((e, i) => (
                <li key={i} className="text-sm">
                  <p className="font-semibold">
                    {EVENT_LABELS[e.event_type] ?? e.event_type}
                    {e.event_type === "status_changed" && e.to_status ? ` : ${STATUS_LABELS[e.to_status]}` : ""}
                  </p>
                  {e.event_type === "rescheduled" && e.old_starts_at && e.new_starts_at && (
                    <p className="text-muted-foreground">
                      {stampFmt.format(new Date(e.old_starts_at))} → {stampFmt.format(new Date(e.new_starts_at))}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{stampFmt.format(new Date(e.created_at))}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-sm lg:sticky lg:top-6">
          <h2 className="font-display text-lg font-bold">Montants</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2">
            <dt className="text-muted-foreground">Prix</dt>
            <dd className="text-right font-semibold">{formatEuros(appt.price_total_cents)}</dd>
            {appt.deposit_amount_cents > 0 && (
              <>
                <dt className="text-muted-foreground">Acompte prévu</dt>
                <dd className="text-right">{formatEuros(appt.deposit_amount_cents)}</dd>
                <dt className="text-muted-foreground">Solde</dt>
                <dd className="text-right">{formatEuros(appt.balance_due_cents)}</dd>
              </>
            )}
          </dl>
          {item?.price_overridden && <p className="text-xs text-muted-foreground">Prix ajusté pour ce rendez-vous (catalogue : {formatEuros(item.catalog_price_cents)}).</p>}
          {archivedService && <p className="text-xs text-muted-foreground">Cette prestation a depuis été archivée ou désactivée dans votre catalogue.</p>}
          <p className="text-xs text-muted-foreground">Prix et durée sont figés à la réservation : un changement de tarif ultérieur ne modifie pas ce rendez-vous. Le paiement en ligne arrivera dans un prochain sprint.</p>
        </aside>
      </div>
    </>
  );
}

function Info({ icon: Icon, label, children }: { icon: typeof Home; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-surface p-3.5 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="mt-0.5 font-medium">{children}</div>
      </div>
    </div>
  );
}
