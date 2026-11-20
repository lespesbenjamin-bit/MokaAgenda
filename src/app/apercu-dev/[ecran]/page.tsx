import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CatalogTabs } from "@/components/catalog/catalog-tabs";
import { ServicesBrowser } from "@/components/catalog/services-browser";
import { ServiceForm } from "@/components/catalog/service-form";
import { EMPTY_SERVICE, toFormDefaults } from "@/components/catalog/service-form-defaults";
import { CategoryManager } from "@/components/catalog/category-manager";
import { CustomersBrowser } from "@/components/customers/customers-browser";
import { AddressesManager, ConsentsForm, CustomerIdentityForm } from "@/components/customers/customer-forms";
import { ImportWizard } from "@/components/customers/import-wizard";
import { buildDemoRows } from "@/server/demo/seed";
import { appEnv } from "@/lib/env";
import { AgendaCalendar } from "@/components/agenda/agenda-calendar";
import { AppointmentForm } from "@/components/agenda/appointment-form";
import { ExceptionsManager, WeeklyHoursEditor } from "@/components/agenda/availability-editor";
import type { CalendarBackground, CalendarEvent } from "@/server/actions/agenda";
import { addDays, isoWeekdayOf, localDate, zonedToUtc } from "@/lib/domain/time";
import { offeredPlaces, totalPriceCents } from "@/lib/domain/pricing";

/**
 * Aperçu visuel des écrans avec les données démo, SANS base de données.
 * Outil de vérification locale uniquement : 404 en production et tant que
 * MOKA_UI_PREVIEW n'est pas défini à 1.
 */
export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: Promise<{ ecran: string }> }) {
  if (appEnv === "production" || process.env.MOKA_UI_PREVIEW !== "1") notFound();
  const { ecran } = await params;

  let n = 0;
  const rows = buildDemoRows("demo", () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
  const cats = rows.categories.map((c) => ({ id: c.id, name: c.name }));
  const services = rows.services.map((s) => {
    const places: Record<string, number | null> = {};
    for (const l of rows.service_locations.filter((l) => l.service_id === s.id)) places[l.place as string] = l.price_cents as number | null;
    const cost = (k: string) => (rows.service_costs.find((c) => c.service_id === s.id && c.kind === k)?.amount_cents as number) ?? 0;
    return {
      id: s.id as string,
      name: s.name as string,
      categoryId: s.category_id as string,
      durationMinutes: s.duration_minutes as number,
      prepMinutes: s.prep_minutes as number,
      cleanupMinutes: s.cleanup_minutes as number,
      isActive: true,
      onlineBookable: true,
      archived: false,
      pricing: {
        basePriceCents: s.base_price_cents as number,
        promoPriceCents: null,
        extraFeeCents: 0,
        vatRateBps: 0,
        places,
        depositType: s.deposit_type as "none",
        depositValue: s.deposit_value as number,
      },
      costs: { consumablesCents: cost("consumables"), productsCents: cost("products"), otherCents: cost("other") },
    };
  });
  const first = services[5];
  const customers = rows.customers.map((c, i) => ({
    id: c.id as string,
    first_name: c.first_name as string,
    last_name: c.last_name as string,
    email: c.email as string | null,
    phone: c.phone as string | null,
    city: (rows.customer_addresses.find((a) => a.customer_id === c.id && a.is_primary)?.city as string) ?? null,
    archived: false,
    source: (i % 6 === 0 ? "import" : "manual") as "manual",
    created_at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
  }));

  // ─── Agenda (données démo générées pour aujourd'hui) ───
  const TZ = "Europe/Paris";
  const now = new Date();
  const nameOf = new Map(rows.customers.map((c) => [c.id as string, `${c.first_name} ${c.last_name}`]));
  const calEvents: CalendarEvent[] = rows.appointments.map((a) => {
    const item = rows.appointment_items.find((i) => i.appointment_id === a.id)!;
    const start = new Date(a.starts_at as string);
    return {
      id: a.id as string,
      title: item.service_name as string,
      start: start.toISOString(),
      end: new Date(start.getTime() + (a.duration_minutes as number) * 60_000).toISOString(),
      status: a.status as CalendarEvent["status"],
      place: a.place as CalendarEvent["place"],
      customer: nameOf.get(a.customer_id as string) ?? "Cliente",
      city: a.city as string | null,
    };
  });
  const calBackgrounds: CalendarBackground[] = [];
  for (let d = -21; d <= 35; d++) {
    const day = addDays(localDate(now, TZ), d);
    for (const r of rows.availability_rules.filter((x) => x.weekday === isoWeekdayOf(day))) {
      calBackgrounds.push({
        start: zonedToUtc(day, r.start_minute as number, TZ).toISOString(),
        end: zonedToUtc(day, r.end_minute as number, TZ).toISOString(),
        kind: r.place === "home" ? "hours-home" : r.place === "salon" ? "hours-salon" : "hours-any",
      });
    }
  }
  for (const e of rows.availability_exceptions) calBackgrounds.push({ start: e.starts_at as string, end: e.ends_at as string, kind: "blocked", label: e.label as string });
  const bookable = services.map((s) => {
    const prices: Record<string, number> = {};
    for (const p of offeredPlaces(s.pricing)) prices[p] = totalPriceCents(s.pricing, p);
    return { id: s.id, name: s.name, category: cats.find((c) => c.id === s.categoryId)?.name ?? null, durationMinutes: s.durationMinutes, mobilizedMinutes: s.durationMinutes + s.prepMinutes + s.cleanupMinutes, prices };
  });

  const screens: Record<string, React.ReactNode> = {
    agenda: (
      <>
        <PageHeader title="Agenda" description="Aperçu avec les rendez-vous démo." />
        <AgendaCalendar timeZone={TZ} hasRules staticData={{ events: calEvents, backgrounds: calBackgrounds }} />
      </>
    ),
    "agenda-nouveau": (
      <>
        <PageHeader title="Nouveau rendez-vous" />
        <AppointmentForm
          services={bookable}
          customers={customers.map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`, phone: c.phone, email: c.email }))}
          allowedPlaces={["salon", "home"]}
          defaults={{ customerId: "", serviceId: "", place: "", date: localDate(now, TZ), time: "10:00", duration: "", price: "", addressId: "", addressLine1: "", addressLine2: "", postalCode: "", city: "", notes: "" }}
        />
      </>
    ),
    horaires: (
      <>
        <PageHeader title="Horaires et disponibilités" />
        <div className="flex flex-col gap-6">
          <WeeklyHoursEditor hybrid canEdit initial={rows.availability_rules.map((r) => ({ weekday: r.weekday as number, startMinute: r.start_minute as number, endMinute: r.end_minute as number, place: r.place as "home" | "salon" | null }))} />
          <ExceptionsManager hybrid canEdit today={localDate(now, TZ)} items={[{ id: "e1", kind: "vacation", label: "Congés (fictif)", period: "Du 8 déc. 2026 au 10 déc. 2026", place: null }]} />
        </div>
      </>
    ),
    prestations: (
      <>
        <PageHeader title="Prestations" description="Aperçu avec les données démo." />
        <CatalogTabs current="services" />
        <ServicesBrowser services={services} categories={cats} canEdit />
      </>
    ),
    "prestation-nouvelle": (
      <>
        <PageHeader title="Nouvelle prestation" />
        <ServiceForm defaults={EMPTY_SERVICE} categories={cats} />
      </>
    ),
    "prestation-modifier": (
      <>
        <PageHeader title={first.name} />
        <ServiceForm
          categories={cats}
          defaults={toFormDefaults({
            id: first.id,
            name: first.name,
            category_id: first.categoryId,
            description: "Soin complet adapté à votre type de peau.",
            duration_minutes: first.durationMinutes,
            prep_minutes: first.prepMinutes,
            cleanup_minutes: first.cleanupMinutes,
            buffer_minutes: 0,
            min_notice_minutes: 1440,
            is_active: true,
            online_bookable: true,
            base_price_cents: first.pricing.basePriceCents,
            promo_price_cents: null,
            extra_fee_cents: 0,
            extra_fee_label: null,
            vat_rate_bps: 0,
            deposit_type: first.pricing.depositType,
            deposit_value: first.pricing.depositValue,
            places: first.pricing.places,
            costs: first.costs,
            photoUrl: null,
          })}
        />
      </>
    ),
    categories: (
      <>
        <PageHeader title="Prestations" />
        <CatalogTabs current="categories" />
        <CategoryManager
          canEdit
          categories={rows.categories.map((c, i) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            isVisible: i !== 5,
            archived: false,
            serviceCount: services.filter((s) => s.categoryId === c.id).length,
          }))}
        />
      </>
    ),
    clientes: (
      <>
        <PageHeader title="Clientes" />
        <CustomersBrowser customers={customers} />
      </>
    ),
    "fiche-cliente": (
      <>
        <PageHeader title={`${customers[0].first_name} ${customers[0].last_name}`} />
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <CustomerIdentityForm
              defaults={{ id: customers[0].id, first_name: customers[0].first_name, last_name: customers[0].last_name, email: customers[0].email ?? "", phone: customers[0].phone ?? "", birth_date: "", notes: "Préfère les rendez-vous en fin de journée." }}
            />
          </div>
          <AddressesManager
            customerId={customers[0].id}
            addresses={rows.customer_addresses
              .filter((a) => a.customer_id === customers[0].id)
              .map((a, i) => ({ id: `a${i}`, kind: a.kind as "home", label: a.label as string | null, line1: a.line1 as string, line2: null, postal_code: a.postal_code as string, city: a.city as string, is_primary: a.is_primary as boolean, geocoded: false }))}
          />
        </div>
      </>
    ),
    consentements: (
      <div className="max-w-2xl rounded-2xl border border-border bg-card p-5">
        <ConsentsForm customerId={customers[0].id} consents={[{ channel: "email", granted: true, recorded_at: "2026-11-20T09:00:00Z" }]} />
      </div>
    ),
    import: (
      <>
        <PageHeader title="Importer des clientes" />
        <ImportWizard />
      </>
    ),
  };
  const content = screens[ecran];
  if (!content) notFound();
  return <AppShell identity={{ name: "Moka Beauty Studio", logoUrl: null, subtitle: "Hybride" }}>{content}</AppShell>;
}
