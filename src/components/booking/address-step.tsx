"use client";

import { useState, useTransition } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Input, Label } from "@/components/ui/input";
import type { AddressCheck, AddressCheckResult } from "@/server/services/public-travel";
import type { PublicService } from "@/lib/domain/public-booking";
import { formatEuros } from "@/lib/domain/pricing";

interface Address {
  line1: string;
  postalCode: string;
  city: string;
}

/**
 * Prestation à domicile : l'adresse est vérifiée (service d'adresses officiel),
 * la zone contrôlée et les frais de déplacement calculés AVANT le choix du créneau.
 */
export function AddressStep({
  service,
  initial,
  check,
  onVerified,
  onBack,
  contactLine,
}: {
  service: PublicService;
  initial: Address;
  check: (a: Address) => Promise<AddressCheckResult>;
  onVerified: (res: AddressCheck, a: Address) => void;
  onBack: () => void;
  contactLine: string;
}) {
  const [a, setA] = useState<Address>(initial);
  const [result, setResult] = useState<AddressCheckResult | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Address, string>>>({});
  const [pending, start] = useTransition();

  function submit(addr: Address) {
    const e: typeof errors = {};
    if (!addr.line1.trim()) e.line1 = "Indiquez le numéro et la rue.";
    if (!/^\d{5}$/.test(addr.postalCode.trim())) e.postalCode = "Code postal à 5 chiffres.";
    if (!addr.city.trim()) e.city = "Indiquez la ville.";
    setErrors(e);
    if (Object.keys(e).length) return;
    start(async () => {
      const res = await check(addr);
      setResult(res);
      if (res.ok) setA({ ...addr, postalCode: res.postcode, city: res.city ?? addr.city });
    });
  }

  const ok = result?.ok ? result : null;

  return (
    <section aria-labelledby="step-address" className="flex flex-col gap-4">
      <div>
        <h2 id="step-address" className="text-lg font-bold">Où a lieu le rendez-vous ?</h2>
        <p className="text-sm text-muted-foreground">{service.name} à domicile. Les frais de déplacement dépendent de votre adresse.</p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          submit(a);
        }}
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-line1">Numéro et rue</Label>
          <Input id="addr-line1" value={a.line1} autoComplete="address-line1" onChange={(e) => { setA({ ...a, line1: e.target.value }); setResult(null); }} aria-invalid={errors.line1 ? true : undefined} />
          {errors.line1 && <FieldError>{errors.line1}</FieldError>}
        </div>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="addr-cp">Code postal</Label>
            <Input id="addr-cp" inputMode="numeric" value={a.postalCode} autoComplete="postal-code" onChange={(e) => { setA({ ...a, postalCode: e.target.value }); setResult(null); }} aria-invalid={errors.postalCode ? true : undefined} />
            {errors.postalCode && <FieldError>{errors.postalCode}</FieldError>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="addr-city">Ville</Label>
            <Input id="addr-city" value={a.city} autoComplete="address-level2" onChange={(e) => { setA({ ...a, city: e.target.value }); setResult(null); }} aria-invalid={errors.city ? true : undefined} />
            {errors.city && <FieldError>{errors.city}</FieldError>}
          </div>
        </div>
        {!ok && (
          <Button type="submit" disabled={pending}>
            {pending ? <><Loader2 className="animate-spin" /> Vérification de l&apos;adresse…</> : <><MapPin /> Vérifier mon adresse</>}
          </Button>
        )}
      </form>

      {result && !result.ok && result.kind === "ambiguous" && (
        <div className="flex flex-col gap-2">
          <FormAlert type="info">{result.message}</FormAlert>
          {result.candidates.map((c) => (
            <button
              key={c.label}
              type="button"
              className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm hover:border-primary"
              onClick={() => {
                const next = { line1: c.line1 || a.line1, postalCode: c.postcode ?? a.postalCode, city: c.city ?? a.city };
                setA(next);
                submit(next);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {result && !result.ok && result.kind !== "ambiguous" && (
        <FormAlert type="error">
          {result.message}
          {contactLine && result.kind !== "not_found" && <span className="mt-1 block font-medium">Contact : {contactLine}</span>}
        </FormAlert>
      )}

      {ok && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm">
            <span className="font-semibold">Adresse vérifiée :</span> {ok.label}
            {!ok.precise && <span className="block text-xs text-muted-foreground">Adresse trouvée au niveau de la rue : ajoutez le numéro si possible.</span>}
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Prestation</dt>
            <dd className="text-right">{formatEuros(ok.serviceCents)}</dd>
            <dt className="text-muted-foreground">Déplacement{ok.zoneName ? ` (${ok.zoneName})` : ""}</dt>
            <dd className="text-right">{ok.feeCents > 0 ? formatEuros(ok.feeCents) : "Offert"}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold">{formatEuros(ok.serviceCents + ok.feeCents)}</dd>
          </dl>
          {ok.feeCents > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Détail du calcul</summary>
              <ul className="mt-1 list-disc pl-4">{ok.feeSteps.map((s) => <li key={s}>{s}</li>)}</ul>
            </details>
          )}
          <Button type="button" onClick={() => onVerified(ok, a)}>Voir les créneaux disponibles</Button>
          <button type="button" className="text-xs underline underline-offset-2" onClick={() => setResult(null)}>Modifier l&apos;adresse</button>
        </div>
      )}
      <button type="button" className="self-start text-sm text-muted-foreground underline underline-offset-2" onClick={onBack}>Retour</button>
    </section>
  );
}
