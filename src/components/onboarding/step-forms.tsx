"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Home, Store, Sparkles, Check } from "lucide-react";
import { Field, FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Label, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import {
  completeOnboardingAction,
  saveActivityModeAction,
  saveBusinessInfoAction,
  saveLocationsAction,
  saveSettingsAction,
} from "@/server/actions/onboarding";
import {
  ACTIVITY_MODE_LABELS,
  ACTIVITY_MODES,
  DURATION_OPTIONS,
  TIMEZONE_OPTIONS,
  needsSalonAddress,
  needsTravelBase,
  type ActivityMode,
} from "@/lib/validation/onboarding";
import type { FormState } from "@/lib/validation/auth";
import { cn } from "@/lib/utils";

const initial: FormState = {};

function Actions({ back, label = "Continuer" }: { back?: number; label?: string }) {
  return (
    <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {back ? (
        <Button asChild variant="ghost">
          <Link href={`/onboarding?etape=${back}`}>
            <ArrowLeft /> Retour
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <SubmitButton size="lg" pendingLabel="Enregistrement…">
        {label}
      </SubmitButton>
    </div>
  );
}

export interface BusinessInfoDefaults {
  name: string;
  activity: string;
  phone: string;
  email: string;
}

export function BusinessInfoForm({ defaults, logoUrl }: { defaults: BusinessInfoDefaults; logoUrl: string | null }) {
  const [state, action] = useActionState(saveBusinessInfoAction, initial);
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <Field label="Nom commercial" name="name" defaultValue={v.name ?? defaults.name} required autoComplete="organization" error={fe.name} />
      <Field label="Activité" name="activity" defaultValue={v.activity ?? defaults.activity} placeholder="Esthéticienne, coiffeuse, prothésiste ongulaire…" error={fe.activity} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Téléphone" name="phone" type="tel" defaultValue={v.phone ?? defaults.phone} autoComplete="tel" error={fe.phone} />
        <Field label="Email professionnel" name="email" type="email" defaultValue={v.email ?? defaults.email} autoComplete="email" error={fe.email} />
      </div>
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo hébergé sur Supabase Storage
          <img src={logoUrl} alt="Logo actuel" width={56} height={56} className="size-14 rounded-2xl border border-border object-cover" />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Sparkles className="size-5" />
          </div>
        )}
        <Field
          className="flex-1"
          label="Logo (facultatif)"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hint="PNG, JPEG ou WebP, 2 Mo maximum."
          error={fe.logo}
        />
      </div>
      <Actions />
    </form>
  );
}

const MODE_ICONS: Record<ActivityMode, typeof Home> = { home: Home, salon: Store, hybrid: Sparkles };

export function ActivityModeForm({ current }: { current: ActivityMode | null }) {
  const [state, action] = useActionState(saveActivityModeAction, initial);
  const [selected, setSelected] = useState<ActivityMode | null>(current);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <fieldset className="grid gap-3">
        <legend className="sr-only">Mode d&apos;activité</legend>
        {ACTIVITY_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode];
          const active = selected === mode;
          return (
            <label
              key={mode}
              className={cn(
                "flex cursor-pointer items-center gap-4 rounded-2xl border p-4 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/25",
                active ? "border-primary bg-accent" : "border-border hover:bg-surface",
              )}
            >
              <input type="radio" name="mode" value={mode} checked={active} onChange={() => setSelected(mode)} className="sr-only" />
              <span className={cn("flex size-11 items-center justify-center rounded-xl", active ? "bg-card text-primary" : "bg-secondary text-muted-foreground")}>
                <Icon className="size-5" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{ACTIVITY_MODE_LABELS[mode].title}</span>
                <span className="block text-sm text-muted-foreground">{ACTIVITY_MODE_LABELS[mode].description}</span>
              </span>
              {active && <Check className="size-5 text-primary" />}
            </label>
          );
        })}
      </fieldset>
      {state.fieldErrors?.mode && <FieldError>{state.fieldErrors.mode}</FieldError>}
      <Actions back={1} />
    </form>
  );
}

export interface AddressDefaults {
  line1: string;
  postal: string;
  city: string;
}

function AddressFields({ prefix, title, defaults, errors, values }: { prefix: "salon" | "travel"; title: string; defaults: AddressDefaults; errors: Record<string, string>; values: Record<string, string> }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 font-semibold">{title}</legend>
      <Field label="Adresse" name={`${prefix}_line1`} defaultValue={values[`${prefix}_line1`] ?? defaults.line1} autoComplete="street-address" error={errors[`${prefix}_line1`]} />
      <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
        <Field label="Code postal" name={`${prefix}_postal`} defaultValue={values[`${prefix}_postal`] ?? defaults.postal} autoComplete="postal-code" inputMode="numeric" error={errors[`${prefix}_postal`]} />
        <Field label="Ville" name={`${prefix}_city`} defaultValue={values[`${prefix}_city`] ?? defaults.city} autoComplete="address-level2" error={errors[`${prefix}_city`]} />
      </div>
    </fieldset>
  );
}

export function LocationsForm({
  mode,
  salon,
  travel,
  radiusKm,
  sameAddress,
}: {
  mode: ActivityMode;
  salon: AddressDefaults;
  travel: AddressDefaults;
  radiusKm: number | null;
  sameAddress: boolean;
}) {
  const [state, action] = useActionState(saveLocationsAction, initial);
  const [same, setSame] = useState(sameAddress);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {needsSalonAddress(mode) && <AddressFields prefix="salon" title="Adresse de l'institut" defaults={salon} errors={fe} values={state.values ?? {}} />}
      {needsTravelBase(mode) && (
        <div className="flex flex-col gap-4">
          {mode === "hybrid" && (
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="travel_same" checked={same} onChange={(e) => setSame(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              Je pars de mon institut pour mes déplacements
            </label>
          )}
          {!(mode === "hybrid" && same) && (
            <AddressFields prefix="travel" title="Point de départ de vos déplacements" defaults={travel} errors={fe} values={state.values ?? {}} />
          )}
          <Field
            label="Zone d'intervention indicative (km)"
            name="radius_km"
            type="number"
            min={0}
            max={200}
            inputMode="numeric"
            defaultValue={state.values?.radius_km ?? radiusKm ?? ""}
            hint="Distance maximale autour de votre point de départ. Facultatif."
            error={fe.radius_km}
          />
        </div>
      )}
      <Actions back={2} />
    </form>
  );
}

export function SettingsForm({ timezone, duration }: { timezone: string; duration: number }) {
  const [state, action] = useActionState(saveSettingsAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Fuseau horaire</Label>
        <Select id="timezone" name="timezone" defaultValue={state.values?.timezone ?? timezone}>
          {TIMEZONE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        {fe.timezone && <FieldError>{fe.timezone}</FieldError>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currency">Devise</Label>
        <Select id="currency" disabled defaultValue="EUR">
          <option value="EUR">Euro (€)</option>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="defaultDuration">Durée de rendez-vous par défaut</Label>
        <Select id="defaultDuration" name="defaultDuration" defaultValue={state.values?.defaultDuration ?? String(duration)}>
          {DURATION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60}` : ""}`}
            </option>
          ))}
        </Select>
        {fe.defaultDuration && <FieldError>{fe.defaultDuration}</FieldError>}
      </div>
      <FormAlert type="info">Vos conditions générales de réservation pourront être complétées plus tard dans les paramètres.</FormAlert>
      <Actions back={3} />
    </form>
  );
}

export function CompleteForm() {
  const [state, action] = useActionState(completeOnboardingAction, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <Actions back={4} label="Accéder à mon tableau de bord" />
    </form>
  );
}
