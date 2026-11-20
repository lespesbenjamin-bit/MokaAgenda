"use client";

import { useActionState, useMemo, useState } from "react";
import { Check, MapPin } from "lucide-react";
import { FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox, Input, Label, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  archiveVehicleAction,
  deleteAreaAction,
  geocodeLocationAction,
  saveAreaAction,
  saveTravelSettingsAction,
  saveVehicleAction,
  type GeocodeLocationState,
} from "@/server/actions/travel";
import type { FormState } from "@/lib/validation/auth";
import {
  PRICING_MODE_LABELS,
  VEHICLE_KIND_LABELS,
  VEHICLE_PRESETS,
  requiredTravelMinutes,
  travelCost,
  travelFee,
  type FeeSettings,
  type PricingMode,
  type ServiceArea,
  type Vehicle,
  type VehicleKind,
} from "@/lib/domain/travel";
import { centsToInput, formatEuros } from "@/lib/domain/pricing";
import { WEEKDAY_LABELS } from "@/lib/domain/appointments";

const millisToInput = (m: number | null | undefined) => (m == null ? "" : (m / 1000).toFixed(3).replace(".", ",").replace(/0+$/, "").replace(/,$/, ""));

function F({ label, name, defaultValue, error, hint, suffix, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string; hint?: string; suffix?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={name} name={name} defaultValue={defaultValue} aria-invalid={error ? true : undefined} {...rest} />
        {suffix && <span className="shrink-0 text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {error ? <FieldError>{error}</FieldError> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ─── Localisation des adresses de l'entreprise ──────────────────────

export function LocationGeocoder({ kind, label, address, located }: { kind: "salon" | "travel_base"; label: string; address: string; located: string | null }) {
  const [state, action] = useActionState<GeocodeLocationState, FormData>(geocodeLocationAction.bind(null, kind), {});
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          <p className="truncate text-sm text-muted-foreground">{address}</p>
          <p className={located ? "text-xs text-success" : "text-xs text-warning"}>{located ? `✓ Localisée : ${located}` : "Non localisée"}</p>
        </div>
        <form action={action}>
          <SubmitButton size="sm" variant="outline" pendingLabel="…">
            <MapPin /> {located ? "Relocaliser" : "Localiser"}
          </SubmitButton>
        </form>
      </div>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      {state.candidates && (
        <div className="flex flex-col gap-1">
          {state.candidates.map((c) => (
            <form key={c} action={action}>
              <input type="hidden" name="choice" value={c} />
              <button className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-primary">{c}</button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Réglages généraux et facturation ───────────────────────────────

export interface TravelSettingsDefaults extends FeeSettings {
  enabled: boolean;
  start_point: "travel_base" | "salon";
  return_point: "none" | "travel_base" | "salon";
  safety_margin_pct: number;
  safety_margin_minutes: number;
  fee_vat_rate_bps: number;
}

export function TravelSettingsForm({ d, hasSalon, hasBase }: { d: TravelSettingsDefaults; hasSalon: boolean; hasBase: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(saveTravelSettingsAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  const [mode, setMode] = useState<PricingMode>((v?.pricing_mode as PricingMode) ?? d.pricing_mode);
  const val = (k: string, fallback: string) => v?.[k] ?? fallback;
  return (
    <form action={action} className="flex flex-col gap-5" key={JSON.stringify(v ?? {})}>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      <Checkbox name="enabled" defaultChecked={v ? v.enabled === "on" : d.enabled} label="Prendre en compte les trajets" hint="Disponibilités, frais de déplacement et tournées. Désactivé : l'agenda fonctionne comme avant." />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="start_point">Point de départ habituel</Label>
          <Select id="start_point" name="start_point" defaultValue={val("start_point", d.start_point)}>
            {hasBase && <option value="travel_base">Adresse de départ des tournées</option>}
            {hasSalon && <option value="salon">Institut</option>}
          </Select>
          {fe.start_point && <FieldError>{fe.start_point}</FieldError>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="return_point">Retour en fin de tournée (facultatif)</Label>
          <Select id="return_point" name="return_point" defaultValue={val("return_point", d.return_point)}>
            <option value="none">Pas de retour compté</option>
            {hasBase && <option value="travel_base">Adresse de départ</option>}
            {hasSalon && <option value="salon">Institut</option>}
          </Select>
        </div>
        <F label="Marge de sécurité sur les trajets" name="safety_margin_pct" inputMode="numeric" defaultValue={val("safety_margin_pct", String(d.safety_margin_pct))} suffix="%" error={fe.safety_margin_pct} hint="Pas de trafic en temps réel : prévoyez une marge." />
        <F label="… et au minimum" name="safety_margin_minutes" inputMode="numeric" defaultValue={val("safety_margin_minutes", String(d.safety_margin_minutes))} suffix="min" error={fe.safety_margin_minutes} hint={`Exemple : 25 min de route → ${requiredTravelMinutes(1500, { safety_margin_pct: d.safety_margin_pct, safety_margin_minutes: d.safety_margin_minutes })} min prévues.`} />
      </div>

      <div className="flex flex-col gap-4 rounded-2xl bg-secondary/60 p-4">
        <p className="text-sm font-bold">Frais facturés à la cliente</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pricing_mode">Mode de facturation</Label>
          <Select id="pricing_mode" name="pricing_mode" value={mode} onChange={(e) => setMode(e.target.value as PricingMode)}>
            {(Object.keys(PRICING_MODE_LABELS) as PricingMode[]).map((m) => (
              <option key={m} value={m}>{PRICING_MODE_LABELS[m]}</option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(mode === "fixed" || mode === "free_above") && <F label="Forfait" name="fixed_fee" inputMode="decimal" defaultValue={val("fixed_fee", centsToInput(d.fixed_fee_cents))} suffix="€" error={fe.fixed_fee} hint={mode === "free_above" ? "Utilisé si aucun tarif au km n'est indiqué." : undefined} />}
          {(mode === "per_km" || mode === "free_above") && (
            <>
              <F label="Tarif par kilomètre" name="per_km" inputMode="decimal" defaultValue={val("per_km", centsToInput(d.per_km_cents))} suffix="€/km" error={fe.per_km} />
              <F label="Distance incluse" name="included_km" inputMode="decimal" defaultValue={val("included_km", String(d.included_km).replace(".", ","))} suffix="km" error={fe.included_km} />
            </>
          )}
          {mode === "free_above" && <F label="Offert à partir de" name="free_above" inputMode="decimal" defaultValue={val("free_above", centsToInput(d.free_above_cents))} suffix="€ de prestation" error={fe.free_above} />}
          {mode !== "free" && mode !== "zone" && (
            <>
              <F label="Minimum de facturation" name="min_fee" inputMode="decimal" defaultValue={val("min_fee", centsToInput(d.min_fee_cents))} suffix="€" error={fe.min_fee} />
              <F label="Maximum (facultatif)" name="max_fee" inputMode="decimal" defaultValue={val("max_fee", centsToInput(d.max_fee_cents))} suffix="€" error={fe.max_fee} />
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fee_vat_rate_bps">TVA sur les frais</Label>
            <Select id="fee_vat_rate_bps" name="fee_vat_rate_bps" defaultValue={val("fee_vat_rate_bps", String(d.fee_vat_rate_bps))}>
              <option value="0">TVA non applicable</option>
              <option value="2000">20 %</option>
              <option value="1000">10 %</option>
              <option value="550">5,5 %</option>
            </Select>
          </div>
        </div>
        {(mode === "zone" || mode !== "free") && <p className="text-xs text-muted-foreground">Le supplément de chaque zone (onglet Zones) s&apos;ajoute aux frais{mode === "zone" ? " : en mode « par zone », c'est le seul montant facturé" : ""}. Les frais ne concernent que les prestations à domicile.</p>}
      </div>
      {/* champs non affichés selon le mode : conservés */}
      {!(mode === "fixed" || mode === "free_above") && <input type="hidden" name="fixed_fee" value={centsToInput(d.fixed_fee_cents)} />}
      {!(mode === "per_km" || mode === "free_above") && (
        <>
          <input type="hidden" name="per_km" value={centsToInput(d.per_km_cents)} />
          <input type="hidden" name="included_km" value={String(d.included_km).replace(".", ",")} />
        </>
      )}
      {mode !== "free_above" && <input type="hidden" name="free_above" value={centsToInput(d.free_above_cents)} />}
      {(mode === "free" || mode === "zone") && (
        <>
          <input type="hidden" name="min_fee" value={centsToInput(d.min_fee_cents)} />
          <input type="hidden" name="max_fee" value={centsToInput(d.max_fee_cents)} />
        </>
      )}
      <SubmitButton className="self-start" pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
    </form>
  );
}

// ─── Véhicule ───────────────────────────────────────────────────────

export function VehicleForm({ vehicle }: { vehicle: (Vehicle & { id?: string; is_default?: boolean }) | null }) {
  const [state, action] = useActionState<FormState, FormData>(saveVehicleAction, {});
  const [archiveState, archive] = useActionState<FormState, FormData>(archiveVehicleAction, {});
  const fe = state.fieldErrors ?? {};
  const [kind, setKind] = useState<VehicleKind>(vehicle?.kind ?? "car_fuel");
  const [values, setValues] = useState(() => toInputs(vehicle ?? { label: "Ma voiture", kind: "car_fuel", ...VEHICLE_PRESETS.car_fuel, hourly_time_cost_cents: 0 }));
  const [estimated, setEstimated] = useState(!vehicle);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues({ ...values, [k]: e.target.value });
    setEstimated(false);
  };
  const unit = kind === "car_electric" ? "kWh" : "L";
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      {archiveState.success && <FormAlert type="success">{archiveState.success}</FormAlert>}
      {vehicle?.id && <input type="hidden" name="id" value={vehicle.id} />}
      <input type="hidden" name="is_default" value="on" />
      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Nom" name="label" value={values.label} onChange={set("label")} error={fe.label} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kind">Type</Label>
          <Select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as VehicleKind;
              setKind(k);
              setValues({ ...toInputs({ label: values.label, kind: k, ...VEHICLE_PRESETS[k], hourly_time_cost_cents: Math.round(Number(values.hourly.replace(",", ".") || 0) * 100) }) });
              setEstimated(true);
            }}
          >
            {(Object.keys(VEHICLE_KIND_LABELS) as VehicleKind[]).map((k) => (
              <option key={k} value={k}>{VEHICLE_KIND_LABELS[k]}</option>
            ))}
          </Select>
        </div>
      </div>
      {estimated && <FormAlert type="info">Valeurs pré-remplies : ce sont des <strong>estimations indicatives</strong>. Remplacez-les par vos vrais chiffres (prix à la pompe, consommation de votre véhicule).</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Consommation moyenne" name="consumption" inputMode="decimal" value={values.consumption} onChange={set("consumption")} suffix={`${unit}/100 km`} error={fe.consumption} />
        <F label={`Prix ${unit === "kWh" ? "de l'électricité" : "du carburant"}`} name="energy_price" inputMode="decimal" value={values.energyPrice} onChange={set("energyPrice")} suffix={`€/${unit}`} error={fe.energy_price} />
        <F label="Usure et entretien" name="wear_per_km" inputMode="decimal" value={values.wear} onChange={set("wear")} suffix="€/km" error={fe.wear_per_km} hint="Pneus, entretien, dépréciation…" />
        <F label="Coût kilométrique global (facultatif)" name="all_in_per_km" inputMode="decimal" value={values.allIn} onChange={set("allIn")} suffix="€/km" error={fe.all_in_per_km} hint="S'il est renseigné, il REMPLACE énergie + usure (pas de double compte)." />
        <F label="Frais fixes par déplacement" name="fixed_per_trip" inputMode="decimal" value={values.fixed} onChange={set("fixed")} suffix="€" error={fe.fixed_per_trip} />
        <F label="Stationnement et péages habituels" name="parking_per_trip" inputMode="decimal" value={values.parking} onChange={set("parking")} suffix="€ / trajet" error={fe.parking_per_trip} />
        <F label="Valeur de votre temps de trajet" name="hourly_cost" inputMode="decimal" value={values.hourly} onChange={set("hourly")} suffix="€/h" error={fe.hourly_cost} hint="Sert au coût économique (ce n'est pas une dépense)." />
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer le véhicule</SubmitButton>
        {vehicle?.id && (
          <button formAction={archive} className="text-sm text-muted-foreground underline underline-offset-2" type="submit">
            Retirer ce véhicule
          </button>
        )}
      </div>
      <CostSimulator vehicle={fromInputs(kind, values)} />
    </form>
  );
}

function toInputs(v: Vehicle) {
  return {
    label: v.label,
    consumption: v.consumption_per_100km == null ? "" : String(v.consumption_per_100km).replace(".", ","),
    energyPrice: millisToInput(v.energy_price_millis),
    wear: millisToInput(v.wear_cost_per_km_millis),
    allIn: millisToInput(v.all_in_cost_per_km_millis),
    fixed: centsToInput(v.fixed_cost_per_trip_cents),
    parking: centsToInput(v.parking_tolls_per_trip_cents),
    hourly: centsToInput(v.hourly_time_cost_cents),
  };
}

function fromInputs(kind: VehicleKind, i: ReturnType<typeof toInputs>): Vehicle {
  const n = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);
  const m = (s: string) => (n(s) == null || Number.isNaN(n(s)) ? null : Math.round(n(s)! * 1000));
  const c = (s: string) => (n(s) == null || Number.isNaN(n(s)) ? 0 : Math.round(n(s)! * 100));
  return {
    label: i.label,
    kind,
    consumption_per_100km: n(i.consumption),
    energy_unit: n(i.consumption) == null ? null : kind === "car_electric" ? "kwh" : "l",
    energy_price_millis: m(i.energyPrice),
    wear_cost_per_km_millis: m(i.wear) ?? 0,
    all_in_cost_per_km_millis: m(i.allIn),
    fixed_cost_per_trip_cents: c(i.fixed),
    parking_tolls_per_trip_cents: c(i.parking),
    hourly_time_cost_cents: c(i.hourly),
  };
}

/** Simulateur : coût réel estimé d'un trajet (aucun appel externe : distance et durée saisies). */
export function CostSimulator({ vehicle, fee }: { vehicle: Vehicle; fee?: FeeSettings }) {
  const [km, setKm] = useState("12");
  const [min, setMin] = useState("20");
  const [service, setService] = useState("50");
  const cost = useMemo(() => travelCost(vehicle, Math.round(Number(km.replace(",", ".")) * 1000) || 0, (Number(min) || 0) * 60), [vehicle, km, min]);
  const billed = fee ? travelFee(fee, Math.round(Number(km.replace(",", ".")) * 1000) || 0, Math.round(Number(service.replace(",", ".")) * 100) || 0) : null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border p-4">
      <p className="text-sm font-bold">Simulateur (distance et durée saisies à la main)</p>
      <div className="grid grid-cols-3 gap-3">
        <F label="Distance" name="sim_km" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} suffix="km" />
        <F label="Durée" name="sim_min" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} suffix="min" />
        {fee && <F label="Prestation" name="sim_service" inputMode="decimal" value={service} onChange={(e) => setService(e.target.value)} suffix="€" />}
      </div>
      {cost && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Énergie{cost.allIn ? " (incluse dans le coût global)" : ""}</dt><dd className="text-right">{formatEuros(cost.energyCents)}</dd>
          <dt className="text-muted-foreground">{cost.allIn ? "Coût kilométrique global" : "Usure"}</dt><dd className="text-right">{formatEuros(cost.wearCents)}</dd>
          <dt className="text-muted-foreground">Temps (valorisé)</dt><dd className="text-right">{formatEuros(cost.timeCents)}</dd>
          <dt className="text-muted-foreground">Autres frais</dt><dd className="text-right">{formatEuros(cost.otherCents)}</dd>
          <dt className="font-semibold">Coût économique total estimé</dt><dd className="text-right font-semibold">{formatEuros(cost.totalCents)}</dd>
          <dt className="text-muted-foreground">dont dépense estimée (hors temps)</dt><dd className="text-right">{formatEuros(cost.cashCents)}</dd>
          {billed && (
            <>
              <dt className="font-semibold">Frais facturés à la cliente</dt><dd className="text-right font-semibold">{formatEuros(billed.feeCents)}</dd>
              <dt className="text-muted-foreground">Part non couverte (coût − frais)</dt><dd className="text-right">{formatEuros(Math.max(0, cost.totalCents - billed.feeCents))}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

// ─── Zones ──────────────────────────────────────────────────────────

export function AreaForm({ area }: { area: (ServiceArea & { is_active: boolean }) | null }) {
  const [state, action] = useActionState<FormState, FormData>(saveAreaAction, {});
  const [del, delAction] = useActionState<FormState, FormData>(deleteAreaAction, {});
  const fe = state.fieldErrors ?? {};
  const [kind, setKind] = useState<"radius" | "postcodes">(area?.kind ?? "radius");
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      {del.success && <FormAlert type="success">{del.success}</FormAlert>}
      {area && <input type="hidden" name="id" value={area.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Nom" name="name" defaultValue={area?.name ?? ""} error={fe.name} placeholder="Ex. : Toulouse centre" />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`kind-${area?.id ?? "new"}`}>Définie par</Label>
          <Select id={`kind-${area?.id ?? "new"}`} name="kind" value={kind} onChange={(e) => setKind(e.target.value as "radius" | "postcodes")}>
            <option value="radius">Distance routière depuis le point de départ</option>
            <option value="postcodes">Liste de codes postaux</option>
          </Select>
        </div>
        {kind === "radius" ? (
          <F label="Jusqu'à (distance par la route)" name="max_km" inputMode="decimal" defaultValue={area?.max_km != null ? String(area.max_km).replace(".", ",") : ""} suffix="km" error={fe.max_km} />
        ) : (
          <F label="Codes postaux" name="postcodes" defaultValue={(area?.postcodes ?? []).join(", ")} error={fe.postcodes} placeholder="31000, 31200, 31300" />
        )}
        <F label="Supplément" name="surcharge" inputMode="decimal" defaultValue={centsToInput(area?.surcharge_cents ?? 0)} suffix="€" error={fe.surcharge} />
        <F label="Montant minimum de prestation" name="min_order" inputMode="decimal" defaultValue={centsToInput(area?.min_order_cents ?? 0)} suffix="€" error={fe.min_order} />
        <F label="Ordre de priorité" name="position" inputMode="numeric" defaultValue={String(area?.position ?? 0)} hint="La première zone correspondante s'applique." />
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-1 text-sm font-semibold">Jours d&apos;intervention (aucun coché = tous)</legend>
        {WEEKDAY_LABELS.map((d, i) => (
          <label key={d} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name={`day_${i + 1}`} defaultChecked={area?.weekdays?.includes(i + 1) ?? false} className="size-4 accent-[var(--primary)]" /> {d.slice(0, 3)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-4">
        <Checkbox name="excluded" defaultChecked={area?.excluded ?? false} label="Zone exclue (jamais desservie)" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingLabel="…"><Check /> {area ? "Enregistrer" : "Ajouter la zone"}</SubmitButton>
        {area && (
          <button formAction={delAction} type="submit" className="text-sm text-muted-foreground underline underline-offset-2">
            Supprimer
          </button>
        )}
      </div>
    </form>
  );
}
