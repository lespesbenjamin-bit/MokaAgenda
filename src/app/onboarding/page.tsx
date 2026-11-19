import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { getMembership } from "@/server/services/business-context";
import { findLocations, findSettings, getLogoUrl } from "@/server/repositories/business";
import {
  ACTIVITY_MODE_LABELS,
  ONBOARDING_STEPS,
  TIMEZONE_OPTIONS,
  resolveOnboardingStep,
} from "@/lib/validation/onboarding";
import {
  ActivityModeForm,
  BusinessInfoForm,
  CompleteForm,
  LocationsForm,
  SettingsForm,
} from "@/components/onboarding/step-forms";
import { FormAlert } from "@/components/ui/form-alert";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Configuration de votre espace" };

const STEP_INTRO: Record<number, string> = {
  1: "Présentez votre entreprise telle que vos clientes la connaissent.",
  2: "Où réalisez-vous vos prestations ?",
  3: "Ces adresses serviront à vos réservations et, plus tard, au calcul des trajets.",
  4: "Les réglages de base de votre agenda.",
  5: "Vérifiez vos informations avant d'ouvrir votre espace.",
};

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const { supabase, membership } = await getMembership();
  const business = membership?.business ?? null;

  if (business?.onboarding_completed_at) redirect(ROUTES.dashboard);
  if (membership && membership.role !== "business_owner") {
    return <FormAlert type="info">La configuration de cette entreprise est réalisée par sa propriétaire.</FormAlert>;
  }

  const params = await searchParams;
  const step = resolveOnboardingStep(business?.onboarding_step ?? 1, typeof params.etape === "string" ? params.etape : undefined);

  const [settings, locations] = business
    ? await Promise.all([findSettings(supabase, business.id), findLocations(supabase, business.id)])
    : [null, []];
  const salon = locations.find((l) => l.kind === "salon");
  const travel = locations.find((l) => l.kind === "travel_base");
  const toDefaults = (l?: typeof salon) => ({ line1: l?.address_line1 ?? "", postal: l?.postal_code ?? "", city: l?.city ?? "" });

  return (
    <div>
      <ol className="mb-8 flex items-center gap-2" aria-label="Progression">
        {ONBOARDING_STEPS.map((s) => {
          const done = s.step < step || (business?.onboarding_step ?? 1) > s.step;
          const current = s.step === step;
          return (
            <li key={s.step} className="flex flex-1 flex-col gap-2" aria-current={current ? "step" : undefined}>
              <span className={cn("h-1.5 rounded-full", current ? "bg-brand" : done ? "bg-primary/60" : "bg-line-strong")} />
              <span className={cn("hidden text-xs font-medium sm:flex sm:items-center sm:gap-1", current ? "text-foreground" : "text-muted-foreground")}>
                {done && !current && <Check className="size-3" />} {s.title}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="text-sm font-semibold text-primary">Étape {step} sur 5</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">{ONBOARDING_STEPS[step - 1].title}</h1>
      <p className="mt-2 text-muted-foreground">{STEP_INTRO[step]}</p>

      <div className="mt-8 rounded-2xl border border-border bg-card p-6 sm:p-7">
        {step === 1 && (
          <BusinessInfoForm
            defaults={{
              name: business?.name ?? "",
              activity: business?.activity ?? "",
              phone: business?.phone ?? "",
              email: business?.email ?? "",
            }}
            logoUrl={getLogoUrl(supabase, business?.logo_path ?? null)}
          />
        )}
        {step === 2 && <ActivityModeForm current={business?.activity_mode ?? null} />}
        {step === 3 && business?.activity_mode && (
          <LocationsForm
            mode={business.activity_mode}
            salon={toDefaults(salon)}
            travel={toDefaults(travel)}
            radiusKm={settings?.service_radius_km ?? null}
            sameAddress={
              Boolean(salon && travel) &&
              salon?.address_line1 === travel?.address_line1 &&
              salon?.city === travel?.city
            }
          />
        )}
        {step === 3 && !business?.activity_mode && <FormAlert type="error">Choisissez d&apos;abord votre mode d&apos;activité (étape 2).</FormAlert>}
        {step === 4 && (
          <SettingsForm timezone={settings?.timezone ?? "Europe/Paris"} duration={settings?.default_appointment_minutes ?? 60} />
        )}
        {step === 5 && business && (
          <div className="flex flex-col gap-6">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Summary label="Entreprise" value={business.name} />
              <Summary label="Activité" value={business.activity ?? "—"} />
              <Summary label="Mode" value={business.activity_mode ? ACTIVITY_MODE_LABELS[business.activity_mode].title : "—"} />
              <Summary label="Contact" value={[business.phone, business.email].filter(Boolean).join(" · ") || "—"} />
              {salon && <Summary label="Institut" value={`${salon.address_line1}, ${salon.postal_code ?? ""} ${salon.city}`} />}
              {travel && <Summary label="Départ des déplacements" value={`${travel.address_line1}, ${travel.postal_code ?? ""} ${travel.city}`} />}
              {settings?.service_radius_km != null && <Summary label="Zone d'intervention" value={`${settings.service_radius_km} km`} />}
              <Summary
                label="Agenda"
                value={`${TIMEZONE_OPTIONS.find((t) => t.value === settings?.timezone)?.label ?? settings?.timezone ?? "—"} · ${settings?.default_appointment_minutes ?? 60} min par défaut`}
              />
            </dl>
            <CompleteForm />
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-3.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
