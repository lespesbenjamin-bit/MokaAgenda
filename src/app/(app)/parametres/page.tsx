import type { Metadata } from "next";
import Link from "next/link";
import { Check, Circle, MailWarning } from "lucide-react";
import { getNavItem } from "@/config/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/layout/page-header";
import { ShareLink } from "@/components/booking/share-link";
import { BookingSettingsForm } from "@/components/settings/booking-settings-form";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { getLogoUrl } from "@/server/repositories/business";
import { listRules } from "@/server/repositories/agenda";
import { listServices } from "@/server/repositories/catalog";
import { mailDriver } from "@/server/notifications/mailer";
import { getSiteUrl } from "@/lib/env";
import { bookingPath } from "@/lib/domain/slug";
import { requiresDeposit } from "@/lib/domain/public-booking";

const item = getNavItem("settings");

export const metadata: Metadata = { title: item.label };

export default async function SettingsPage() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const { business, settings } = ctx;
  const [rules, services] = await Promise.all([listRules(supabase, business.id), listServices(supabase, business.id)]);

  const bookable = services.filter((s) => s.is_active && s.online_bookable && Object.keys(s.places).length > 0);
  const withDeposit = bookable.filter((s) => requiresDeposit(s));
  const siteUrl = getSiteUrl();
  const url = `${siteUrl}${bookingPath(business.slug)}`;
  const driver = mailDriver();
  const enabled = settings?.booking_enabled ?? false;

  const checklist = [
    { label: "Horaires de travail renseignés", done: rules.length > 0, href: "/agenda/disponibilites" },
    { label: `Au moins une prestation réservable sans acompte (${bookable.length - withDeposit.length})`, done: bookable.length - withDeposit.length > 0, href: "/prestations" },
    { label: "Page activée", done: enabled },
  ];

  return (
    <div>
      <PageHeader title={item.label} description="Votre page de réservation en ligne et ses règles." />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Réservation en ligne</CardTitle>
              <Badge variant={enabled ? "available" : "soon"}>{enabled ? "En ligne" : "Désactivée"}</Badge>
            </div>
            <CardDescription>Vos clientes réservent sans créer de compte. Les rendez-vous arrivent directement dans votre agenda.</CardDescription>
          </CardHeader>
          <CardContent>
            {ctx.role === "business_owner" ? (
              <BookingSettingsForm
                siteUrl={siteUrl}
                defaults={{
                  booking_enabled: enabled,
                  slug: business.slug,
                  public_description: settings?.public_description ?? "",
                  public_phone: settings?.public_phone ?? "",
                  public_email: settings?.public_email ?? "",
                  public_instagram: settings?.public_instagram ?? "",
                  cancellation_policy: settings?.cancellation_policy ?? "",
                  booking_terms: settings?.booking_terms ?? "",
                  cancellation_notice_hours: settings?.cancellation_notice_hours ?? 24,
                  customer_can_cancel: settings?.customer_can_cancel ?? true,
                  customer_can_reschedule: settings?.customer_can_reschedule ?? true,
                  booking_window_days: settings?.booking_window_days ?? 60,
                  slot_step_minutes: settings?.slot_step_minutes ?? 15,
                  notification_email: settings?.notification_email ?? "",
                  coverUrl: getLogoUrl(supabase, settings?.cover_path ?? null),
                  defaultNotificationEmail: business.email,
                }}
              />
            ) : (
              <FormAlert type="info">Seule la propriétaire du compte peut modifier ces réglages.</FormAlert>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Votre lien</CardTitle>
              <CardDescription>{enabled ? "À partager partout." : "Activez la page pour que ce lien fonctionne."}</CardDescription>
            </CardHeader>
            <CardContent>
              <ShareLink url={url} title={business.name} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Avant d&apos;ouvrir</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2.5 text-sm">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    {c.done ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    {c.href && !c.done ? <Link href={c.href} className="underline underline-offset-2">{c.label}</Link> : <span>{c.label}</span>}
                  </li>
                ))}
              </ul>
              {withDeposit.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {withDeposit.length} prestation{withDeposit.length > 1 ? "s" : ""} avec acompte : visible{withDeposit.length > 1 ? "s" : ""} sur la page mais non réservable{withDeposit.length > 1 ? "s" : ""} en ligne tant que le paiement n&apos;est pas disponible.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Emails automatiques</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {driver === "resend" && <p className="text-success">Actifs : confirmation, annulation et modification sont envoyés automatiquement.</p>}
              {driver === "simulated" && <p>Démonstration : les emails sont simulés, aucun n&apos;est réellement envoyé.</p>}
              {driver === "disabled" && (
                <p className="flex items-start gap-2 text-warning">
                  <MailWarning className="mt-0.5 size-4 shrink-0" />
                  Pas encore configurés : les réservations fonctionnent, mais aucun email n&apos;est envoyé. La cliente garde le lien de gestion affiché après sa réservation.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>À venir</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                {item.planned.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
