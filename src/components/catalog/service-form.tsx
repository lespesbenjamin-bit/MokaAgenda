"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Home, Info, Store } from "lucide-react";
import { Field, FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox, Label, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { createServiceAction, updateServiceAction } from "@/server/actions/catalog";
import {
  VAT_OPTIONS,
  depositAmountCents,
  formatDuration,
  formatEuros,
  indicativeMargin,
  offeredPlaces,
  parseEurosToCents,
  totalMobilizedMinutes,
  totalPriceCents,
  type Place,
  type ServicePricing,
} from "@/lib/domain/pricing";
import { MIN_NOTICE_OPTIONS } from "@/lib/validation/services";
import type { FormState } from "@/lib/validation/auth";
import { cn } from "@/lib/utils";
import type { ServiceFormDefaults } from "./service-form-defaults";

interface Preview {
  rows: { place: Place; total: number; deposit: number; margin: number; rate: number | null }[];
  mobilized: number | null;
}

function computePreview(form: HTMLFormElement): Preview {
  const fd = new FormData(form);
  const s = (k: string) => String(fd.get(k) ?? "");
  const money = (k: string) => {
    const v = parseEurosToCents(s(k));
    return v === null || Number.isNaN(v) || v < 0 ? null : v;
  };
  const base = money("base_price");
  const places: ServicePricing["places"] = {};
  if (fd.get("offer_salon") === "on") places.salon = money("salon_price");
  if (fd.get("offer_home") === "on") places.home = money("home_price");
  const depositType = (s("deposit_type") || "none") as ServicePricing["depositType"];
  const pct = Number(s("deposit_percent"));
  const pricing: ServicePricing = {
    basePriceCents: base ?? 0,
    promoPriceCents: money("promo_price"),
    extraFeeCents: money("extra_fee") ?? 0,
    vatRateBps: Number(s("vat_rate_bps")) || 0,
    places,
    depositType,
    depositValue: depositType === "fixed" ? money("deposit_fixed") ?? 0 : depositType === "percentage" && Number.isFinite(pct) ? pct : 0,
  };
  const costs = { consumablesCents: money("cost_consumables") ?? 0, productsCents: money("cost_products") ?? 0, otherCents: money("cost_other") ?? 0 };
  const d = Number(s("duration_minutes"));
  const mobilized =
    Number.isInteger(d) && d > 0
      ? totalMobilizedMinutes({ durationMinutes: d, prepMinutes: Number(s("prep_minutes")) || 0, cleanupMinutes: Number(s("cleanup_minutes")) || 0 })
      : null;
  if (base === null) return { rows: [], mobilized };
  return {
    mobilized,
    rows: offeredPlaces(pricing).map((place) => {
      const total = totalPriceCents(pricing, place);
      const m = indicativeMargin(pricing, costs, place);
      return { place, total, deposit: depositAmountCents(pricing, total), margin: m.contributionCents, rate: m.marginRatePct };
    }),
  };
}

export function ServiceForm({
  defaults,
  categories,
}: {
  defaults: ServiceFormDefaults;
  categories: { id: string; name: string }[];
}) {
  const action = defaults.id ? updateServiceAction : createServiceAction;
  const [state, formAction] = useActionState(action, {} as FormState);
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  const val = (k: keyof ServiceFormDefaults) => (v ? v[k] ?? "" : String(defaults[k] ?? ""));
  const checked = (k: "is_active" | "online_bookable" | "offer_salon" | "offer_home") => (v ? v[k] === "on" : defaults[k]);

  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<Preview>({ rows: [], mobilized: null });
  const [depositType, setDepositType] = useState<string>(v?.deposit_type ?? defaults.deposit_type);
  const [offerSalon, setOfferSalon] = useState(checked("offer_salon"));
  const [offerHome, setOfferHome] = useState(checked("offer_home"));
  const refresh = useCallback(() => {
    if (formRef.current) setPreview(computePreview(formRef.current));
  }, []);
  useEffect(refresh, [refresh, state]);

  return (
    <form ref={formRef} action={formAction} onChange={refresh} className="grid items-start gap-6 lg:grid-cols-[1fr_320px]" noValidate>
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

      <div className="flex flex-col gap-6">
        {state.error && <FormAlert type="error">{state.error}</FormAlert>}

        <Section title="Informations générales">
          <Field label="Nom de la prestation" name="name" defaultValue={val("name")} required error={fe.name} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category_id">Catégorie</Label>
            <Select id="category_id" name="category_id" defaultValue={val("category_id")}>
              <option value="">Sans catégorie</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {fe.category_id ? (
              <FieldError>{fe.category_id}</FieldError>
            ) : (
              categories.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Astuce : créez d&apos;abord vos <Link href="/prestations/categories" className="font-semibold text-primary hover:underline">catégories</Link>.
                </p>
              )
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={val("description")} maxLength={2000} placeholder="Ce que comprend la prestation, ce que la cliente doit savoir…" />
            {fe.description && <FieldError>{fe.description}</FieldError>}
          </div>
          <div className="flex items-center gap-4">
            {defaults.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- photo hébergée sur Supabase Storage
              <img src={defaults.photoUrl} alt="Photo actuelle" width={64} height={64} className="size-16 rounded-xl border border-border object-cover" />
            )}
            <Field className="flex-1" label="Photo (facultative)" name="photo" type="file" accept="image/png,image/jpeg,image/webp" hint="PNG, JPEG ou WebP, 2 Mo maximum." error={fe.photo} />
          </div>
          <Checkbox name="is_active" defaultChecked={checked("is_active")} label="Prestation active" hint="Une prestation inactive reste dans votre catalogue mais n'est plus proposée." />
        </Section>

        <Section title="Durées" description="En minutes.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Durée de la prestation" name="duration_minutes" type="number" inputMode="numeric" min={5} max={720} defaultValue={val("duration_minutes")} required error={fe.duration_minutes} />
            <Field label="Préparation" name="prep_minutes" type="number" inputMode="numeric" min={0} max={240} defaultValue={val("prep_minutes")} error={fe.prep_minutes} />
            <Field label="Nettoyage / rangement" name="cleanup_minutes" type="number" inputMode="numeric" min={0} max={240} defaultValue={val("cleanup_minutes")} error={fe.cleanup_minutes} />
          </div>
          {preview.mobilized !== null && (
            <p className="text-sm text-muted-foreground">
              Temps total mobilisé : <strong className="text-foreground">{formatDuration(preview.mobilized)}</strong>
            </p>
          )}
        </Section>

        <Section title="Tarification" description="Prix TTC, c'est-à-dire ce que paie la cliente.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prix de vente (€)" name="base_price" inputMode="decimal" placeholder="45" defaultValue={val("base_price")} required error={fe.base_price} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vat_rate_bps">Régime de TVA</Label>
              <Select id="vat_rate_bps" name="vat_rate_bps" defaultValue={val("vat_rate_bps")}>
                {VAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {fe.vat_rate_bps && <FieldError>{fe.vat_rate_bps}</FieldError>}
            </div>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold">Où proposez-vous cette prestation ?</legend>
            <PlaceRow
              icon={Store}
              label="En institut"
              checkName="offer_salon"
              checked={offerSalon}
              onCheck={setOfferSalon}
              priceName="salon_price"
              priceDefault={val("salon_price")}
              error={fe.salon_price}
            />
            <PlaceRow
              icon={Home}
              label="À domicile"
              checkName="offer_home"
              checked={offerHome}
              onCheck={setOfferHome}
              priceName="home_price"
              priceDefault={val("home_price")}
              error={fe.home_price}
            />
            {fe.places && <FieldError>{fe.places}</FieldError>}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Prix promotionnel (€)" name="promo_price" inputMode="decimal" defaultValue={val("promo_price")} hint="Facultatif." error={fe.promo_price} />
            <Field label="Supplément (€)" name="extra_fee" inputMode="decimal" defaultValue={val("extra_fee")} hint="Facultatif." error={fe.extra_fee} />
            <Field label="Libellé du supplément" name="extra_fee_label" defaultValue={val("extra_fee_label")} placeholder="Ex. pose de strass" maxLength={80} />
          </div>
        </Section>

        <Section title="Coûts internes estimés" description="Par prestation, pour calculer votre marge indicative. Jamais affichés aux clientes.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Consommables (€)" name="cost_consumables" inputMode="decimal" defaultValue={val("cost_consumables")} hint="Cire, coton, gants…" error={fe.cost_consumables} />
            <Field label="Produits utilisés (€)" name="cost_products" inputMode="decimal" defaultValue={val("cost_products")} hint="Crèmes, vernis…" error={fe.cost_products} />
            <Field label="Autres frais variables (€)" name="cost_other" inputMode="decimal" defaultValue={val("cost_other")} hint="Linge, commission…" error={fe.cost_other} />
          </div>
        </Section>

        <Section title="Réservation">
          <Checkbox name="online_bookable" defaultChecked={checked("online_bookable")} label="Réservable en ligne" hint="Proposée sur votre future page de réservation." />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="min_notice_minutes">Délai minimum avant réservation</Label>
              <Select id="min_notice_minutes" name="min_notice_minutes" defaultValue={val("min_notice_minutes")}>
                {MIN_NOTICE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <Field label="Temps tampon après le rendez-vous (min)" name="buffer_minutes" type="number" inputMode="numeric" min={0} max={240} defaultValue={val("buffer_minutes")} error={fe.buffer_minutes} />
          </div>
        </Section>

        <Section title="Acompte" description="Demandé à la réservation. Le paiement en ligne arrivera dans un prochain sprint.">
          <fieldset className="grid gap-2 sm:grid-cols-3">
            <legend className="sr-only">Type d&apos;acompte</legend>
            {(
              [
                ["none", "Aucun acompte"],
                ["fixed", "Montant fixe"],
                ["percentage", "Pourcentage"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm font-medium has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/25",
                  depositType === value ? "border-primary bg-accent" : "border-border",
                )}
              >
                <input type="radio" name="deposit_type" value={value} checked={depositType === value} onChange={() => setDepositType(value)} className="accent-[var(--primary)]" />
                {label}
              </label>
            ))}
          </fieldset>
          {depositType === "fixed" && (
            <Field label="Montant de l'acompte (€)" name="deposit_fixed" inputMode="decimal" defaultValue={val("deposit_fixed")} required error={fe.deposit_fixed} />
          )}
          {depositType === "percentage" && (
            <Field label="Pourcentage du prix (%)" name="deposit_percent" type="number" inputMode="numeric" min={0} max={100} defaultValue={val("deposit_percent")} required error={fe.deposit_percent} />
          )}
        </Section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button asChild variant="ghost">
            <Link href="/prestations">Annuler</Link>
          </Button>
          <SubmitButton size="lg" pendingLabel="Enregistrement…">
            {defaults.id ? "Enregistrer les modifications" : "Créer la prestation"}
          </SubmitButton>
        </div>
      </div>

      <aside className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6" aria-live="polite">
        <h2 className="font-display text-lg font-bold">Rentabilité indicative</h2>
        {preview.rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Renseignez un prix et au moins un lieu pour voir le calcul.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {preview.rows.map((r) => (
              <li key={r.place} className="rounded-xl bg-surface p-3.5 text-sm">
                <p className="flex items-center gap-1.5 font-semibold">
                  {r.place === "home" ? <Home className="size-4" /> : <Store className="size-4" />}
                  {r.place === "home" ? "À domicile" : "En institut"}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-y-1">
                  <dt className="text-muted-foreground">Prix payé</dt>
                  <dd className="text-right font-medium">{formatEuros(r.total)}</dd>
                  {r.deposit > 0 && (
                    <>
                      <dt className="text-muted-foreground">Acompte</dt>
                      <dd className="text-right font-medium">{formatEuros(r.deposit)}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Marge indicative</dt>
                  <dd className={cn("text-right font-bold", r.margin < 0 && "text-destructive")}>
                    {formatEuros(r.margin)}
                    {r.rate !== null && <span className="ml-1 text-xs font-medium text-muted-foreground">({r.rate.toLocaleString("fr-FR")} %)</span>}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Prix HT moins consommables et coûts directs, avant frais de déplacement, cotisations et charges fixes. Ce n&apos;est pas un bénéfice net.
        </p>
      </aside>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function PlaceRow({
  icon: Icon,
  label,
  checkName,
  checked,
  onCheck,
  priceName,
  priceDefault,
  error,
}: {
  icon: typeof Home;
  label: string;
  checkName: string;
  checked: boolean;
  onCheck: (v: boolean) => void;
  priceName: string;
  priceDefault: string;
  error?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center", checked ? "border-primary/40 bg-accent/40" : "border-border")}>
      <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-sm font-semibold">
        <input type="checkbox" name={checkName} checked={checked} onChange={(e) => onCheck(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        <Icon className="size-4 text-muted-foreground" /> {label}
      </label>
      {checked && (
        <Field
          className="sm:w-56"
          label="Tarif spécifique (€)"
          name={priceName}
          inputMode="decimal"
          defaultValue={priceDefault}
          placeholder="= prix de vente"
          error={error}
        />
      )}
    </div>
  );
}

