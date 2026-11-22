import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, CalendarClock, Mail, Phone, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { ActionButton } from "@/components/ui/action-button";
import { AddressesManager, ConsentsForm, CustomerIdentityForm, PreferencesForm } from "@/components/customers/customer-forms";
import { customerQuickAction } from "@/server/actions/customers";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { getCustomer, listAddresses, listConsents } from "@/server/repositories/customers";
import { displayName, initials } from "@/lib/domain/customers";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/domain/pricing";
import { loadCustomerFinance } from "@/server/services/finance";

export const metadata: Metadata = { title: "Fiche cliente" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [
  { key: "informations", label: "Informations" },
  { key: "rendez-vous", label: "Rendez-vous" },
  { key: "finances", label: "Finances" },
  { key: "preferences", label: "Préférences" },
  { key: "consentements", label: "Consentements" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

export default async function CustomerPage({ params, searchParams }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.onglet) ? (sp.onglet as Tab) : "informations";

  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const customer = await getCustomer(supabase, ctx.business.id, id);
  if (!customer) notFound();
  const [addresses, consents] = await Promise.all([
    tab === "informations" ? listAddresses(supabase, ctx.business.id, id) : Promise.resolve([]),
    tab === "consentements" ? listConsents(supabase, ctx.business.id, id) : Promise.resolve([]),
  ]);
  const archived = Boolean(customer.archived_at);
  const fin = tab === "finances" ? await loadCustomerFinance(id) : null;

  return (
    <>
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Toutes les clientes
      </Link>

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-accent-foreground">{initials(customer)}</span>
          <div>
            <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {displayName(customer)}
              {archived && <Badge variant="soon">Archivée</Badge>}
            </h1>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {customer.phone && (
                <a href={`tel:${customer.phone}`} className="flex items-center gap-1 hover:text-foreground">
                  <Phone className="size-3.5" /> {customer.phone}
                </a>
              )}
              {customer.email && (
                <a href={`mailto:${customer.email}`} className="flex items-center gap-1 hover:text-foreground">
                  <Mail className="size-3.5" /> {customer.email}
                </a>
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Créée le {dateFmt.format(new Date(customer.created_at))}
              {customer.source === "import" ? " par import" : ""} · modifiée le {dateFmt.format(new Date(customer.updated_at))}
            </p>
          </div>
        </div>
        {archived ? (
          <ActionButton action={customerQuickAction} fields={{ id, op: "restore" }} size="default">
            <ArchiveRestore /> Restaurer la fiche
          </ActionButton>
        ) : (
          <ActionButton
            action={customerQuickAction}
            fields={{ id, op: "archive" }}
            size="default"
            confirm={{
              title: `Archiver la fiche de ${displayName(customer)} ?`,
              description: "Elle n'apparaîtra plus dans votre liste, mais toutes ses informations sont conservées. Vous pourrez la restaurer.",
              confirmLabel: "Archiver",
            }}
          >
            <Archive /> Archiver
          </ActionButton>
        )}
      </header>

      {sp.cree === "1" && (
        <div className="mb-5">
          <FormAlert type="success">Fiche créée.</FormAlert>
        </div>
      )}

      <nav aria-label="Sections de la fiche" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/clientes/${id}?onglet=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
              tab === t.key ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "informations" && (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <CustomerIdentityForm
              defaults={{
                id,
                first_name: customer.first_name,
                last_name: customer.last_name,
                email: customer.email ?? "",
                phone: customer.phone ?? "",
                birth_date: customer.birth_date ?? "",
                notes: customer.notes ?? "",
              }}
            />
          </div>
          <AddressesManager
            customerId={id}
            addresses={addresses.map((a) => ({
              id: a.id,
              kind: a.kind,
              label: a.label,
              line1: a.line1,
              line2: a.line2,
              postal_code: a.postal_code,
              city: a.city,
              is_primary: a.is_primary,
              geocoded: Boolean(a.geocoded_at),
            }))}
          />
        </div>
      )}

      {tab === "rendez-vous" && (
        <Unavailable icon={CalendarClock} title="Historique des rendez-vous" text="L'historique et les rendez-vous à venir de cette cliente apparaîtront ici dès que l'agenda sera disponible." />
      )}

      {tab === "finances" && (
        <div className="flex flex-col gap-4">
          {!fin ? (
            <Unavailable icon={Wallet} title="Indicateurs réservés" text="Les données financières des clientes ne sont visibles que par la propriétaire du compte." />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {[
                  ["Rendez-vous terminés", String(fin.completedCount)],
                  ["Dernière visite", fin.lastVisit ? dateFmt.format(new Date(fin.lastVisit)) : "—"],
                  ["CA historique (TTC)", formatEuros(fin.revenueTtc)],
                  ["Panier moyen (TTC)", fin.avgBasketTtc != null ? formatEuros(fin.avgBasketTtc) : "—"],
                  ["Fréquence", fin.avgDaysBetweenVisits != null ? `tous les ${fin.avgDaysBetweenVisits} jours en moyenne` : "—"],
                  ["Marge contributive estimée", formatEuros(fin.estimatedMargin)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-border bg-card p-4">
                    <p className="text-sm font-medium text-muted-foreground">{label}</p>
                    <p className="mt-1 font-display text-xl font-bold">{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Calculé uniquement sur les rendez-vous terminés (prix figés à la réservation) ; les arrhes payées ne comptent pas comme une prestation supplémentaire. {fin.upcomingCount > 0 ? `${fin.upcomingCount} rendez-vous à venir non comptés. ` : ""}Marge = CA HT − consommables, produits, coûts directs et coût des trajets (estimé).
              </p>
            </>
          )}
        </div>
      )}

      {tab === "preferences" && (
        <div className="max-w-2xl rounded-2xl border border-border bg-card p-5 sm:p-6">
          <PreferencesForm customerId={id} contactPreference={customer.contact_preference} preferences={customer.preferences ?? ""} />
        </div>
      )}

      {tab === "consentements" && (
        <div className="max-w-2xl rounded-2xl border border-border bg-card p-5 sm:p-6">
          <ConsentsForm customerId={id} consents={consents} />
        </div>
      )}

      {archived && (
        <p className="mt-6 text-sm text-muted-foreground">
          Cette fiche est archivée. <Button asChild variant="link" className="h-auto p-0"><Link href="/clientes">Retour à la liste</Link></Button>
        </p>
      )}
    </>
  );
}

function Unavailable({ icon: Icon, title, text }: { icon: typeof Wallet; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-card px-6 py-12 text-center">
      <Icon className="size-7 text-muted-foreground" />
      <p className="font-display text-lg font-bold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
      <Badge variant="soon">Disponible avec l&apos;agenda</Badge>
    </div>
  );
}
