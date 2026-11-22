"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Clock, Home, Lock, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox, Input, Label, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { SlotPicker } from "./slot-picker";
import { checkHomeAddressAction, createPublicBookingAction, type BookingState } from "@/server/actions/public-booking";
import type { AddressCheck } from "@/server/services/public-travel";
import { AddressStep } from "./address-step";
import type { DaySlots } from "@/server/services/public-booking";
import {
  DEPOSIT_UNAVAILABLE_MESSAGE,
  PLACE_LABELS,
  depositDescription,
  depositCentsFor,
  defaultDepositTerms,
  DEPOSIT_KIND_LABEL,
  formatAddress,
  lowestPrice,
  priceFor,
  requiresDeposit,
  type PublicPage,
  type PublicService,
} from "@/lib/domain/public-booking";
import { formatDuration, formatEuros, type Place } from "@/lib/domain/pricing";
import { parseBookingForm } from "@/lib/validation/public-booking";
import { cn } from "@/lib/utils";

const STEPS = ["Prestation", "Lieu", "Créneau", "Coordonnées", "Récapitulatif"] as const;

type Contact = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  comment: string;
  accept_terms: boolean;
};

const EMPTY_CONTACT: Contact = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  postal_code: "",
  city: "",
  comment: "",
  accept_terms: false,
};


export function BookingWizard({
  page,
  photoUrls,
  today,
  lastDay,
  idempotencyKey,
  renderedAt,
  isDemo,
  preview,
}: {
  page: PublicPage;
  photoUrls: Record<string, string>;
  today: string;
  lastDay: string;
  idempotencyKey: string;
  renderedAt: number;
  isDemo: boolean;
  /** Aperçu local uniquement (captures d'écran) : étape et choix pré-remplis, créneaux fixes. */
  preview?: { step: number; serviceId?: string; place?: Place; startsAt?: string; contact?: Partial<Contact>; days?: DaySlots[]; addressCheck?: AddressCheck; askAddress?: boolean };
}) {
  const [state, formAction] = useActionState<BookingState, FormData>(createPublicBookingAction, {});
  const [step, setStep] = useState(preview?.step ?? 0);
  const [serviceId, setServiceId] = useState<string | null>(preview?.serviceId ?? null);
  const [place, setPlace] = useState<Place | null>(preview?.place ?? null);
  const [startsAt, setStartsAt] = useState<string | null>(preview?.startsAt ?? null);
  const [contact, setContact] = useState<Contact>({ ...EMPTY_CONTACT, ...preview?.contact });
  // Déplacements (Sprint 5) : adresse vérifiée avant les créneaux, frais affichés avant confirmation
  const travelOn = Boolean(page.travel?.enabled);
  const [addressCheck, setAddressCheck] = useState<AddressCheck | null>(preview?.addressCheck ?? null);
  const [askAddress, setAskAddress] = useState(Boolean(preview?.askAddress));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);

  const service = page.services.find((s) => s.id === serviceId) ?? null;
  const tz = page.settings.timezone;
  const errors = { ...(state.fieldErrors ?? {}), ...clientErrors };

  // Retour du serveur : créneau pris → retour au choix du créneau ; champ invalide → coordonnées.
  // (Ajustement pendant le rendu, sans effet : modèle recommandé par React.)
  const [handledState, setHandledState] = useState(state);
  if (handledState !== state) {
    setHandledState(state);
    if (state.slotUnavailable) {
      setStartsAt(null);
      setStep(2);
      setRefreshKey((k) => k + 1);
    } else if (state.fieldErrors && Object.keys(state.fieldErrors).length) {
      setStep(3);
    }
  }

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const grouped = useMemo(() => {
    const byCat = new Map<string | null, PublicService[]>();
    for (const s of page.services) {
      const key = page.categories.some((c) => c.id === s.category_id) ? s.category_id : null;
      byCat.set(key, [...(byCat.get(key) ?? []), s]);
    }
    const out: { id: string | null; name: string | null; description: string | null; services: PublicService[] }[] = [];
    for (const c of page.categories) if (byCat.has(c.id)) out.push({ id: c.id, name: c.name, description: c.description, services: byCat.get(c.id)! });
    if (byCat.has(null)) out.push({ id: null, name: page.categories.length ? "Autres prestations" : null, description: null, services: byCat.get(null)! });
    return out;
  }, [page]);

  // Arrhes / acompte payés en ligne (Sprint 6) : seulement si le compte Stripe de la professionnelle est actif.
  const payOnline = Boolean(page.payment?.online);
  const depositKind = page.payment?.deposit_kind ?? "arrhes";

  const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  function chooseService(s: PublicService) {
    if (requiresDeposit(s) && !payOnline) return;
    setServiceId(s.id);
    setStartsAt(null);
    setAddressCheck(null);
    if (s.places.length === 1) {
      setPlace(s.places[0].place);
      if (s.places[0].place === "home" && travelOn) {
        setAskAddress(true);
        setStep(1);
      } else setStep(2);
    } else {
      setPlace(null);
      setStep(1);
    }
  }

  function validateContact(): boolean {
    const r = parseBookingForm({
      slug: page.business.slug,
      service_id: serviceId,
      place,
      starts_at: startsAt,
      ...contact,
      accept_terms: contact.accept_terms ? "on" : undefined,
      idempotency_key: idempotencyKey,
    });
    if (r.ok) {
      setClientErrors({});
      return true;
    }
    setClientErrors(r.errors);
    return false;
  }

  const set = (k: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setContact((c) => ({ ...c, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  const price = service && place ? priceFor(service, place) : null;
  const serviceNow = place === "home" && travelOn && addressCheck ? addressCheck.serviceCents : (price ?? 0);
  const totalNow = place === "home" && travelOn && addressCheck ? addressCheck.serviceCents + addressCheck.feeCents : (price ?? 0);
  const depositNow = service && payOnline && requiresDeposit(service) ? depositCentsFor(service, serviceNow) : 0;
  const noticeHours = page.settings.cancellation_notice_hours;

  return (
    <div ref={topRef} className="scroll-mt-4">
      {/* Progression */}
      <ol className="mb-5 flex gap-1.5" aria-label="Étapes de la réservation">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <span className={cn("block h-1.5 rounded-full", i <= step ? "bg-primary" : "bg-secondary")} />
            <span className={cn("mt-1.5 hidden text-[11px] font-medium sm:block", i === step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
          </li>
        ))}
      </ol>
      <p className="mb-4 text-xs font-medium text-muted-foreground sm:hidden">
        Étape {step + 1} sur {STEPS.length} · {STEPS[step]}
      </p>

      {step > 0 && (
        <Button type="button" variant="ghost" size="sm" className="-ml-3 mb-2" onClick={() => setStep(step === 2 && service?.places.length === 1 ? 0 : step - 1)}>
          <ArrowLeft /> Retour
        </Button>
      )}

      {state.error && !state.slotUnavailable && step < 3 && <div className="mb-4"><FormAlert type="error">{state.error}</FormAlert></div>}
      {state.success && <div className="mb-4"><FormAlert type="success">{state.success}</FormAlert></div>}

      {/* Étape 1 — Prestation */}
      {step === 0 && (
        <section aria-labelledby="step-service" className="flex flex-col gap-6">
          <h2 id="step-service" className="text-lg font-bold">Choisissez une prestation</h2>
          {!page.has_hours && <FormAlert type="info">Les horaires de réservation ne sont pas encore publiés. Revenez bientôt !</FormAlert>}
          {page.services.length === 0 && <FormAlert type="info">Aucune prestation n&apos;est réservable en ligne pour le moment.</FormAlert>}
          {grouped.map((g) => (
            <div key={g.id ?? "none"} className="flex flex-col gap-3">
              {g.name && (
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{g.name}</h3>
                  {g.description && <p className="text-sm text-muted-foreground">{g.description}</p>}
                </div>
              )}
              {g.services.map((s) => {
                const deposit = requiresDeposit(s) && !payOnline;
                const many = s.places.length > 1 && new Set(s.places.map((p) => p.price_cents)).size > 1;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={deposit || !page.has_hours}
                    onClick={() => chooseService(s)}
                    className={cn(
                      "flex w-full gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors",
                      deposit || !page.has_hours ? "cursor-not-allowed" : "hover:border-primary hover:bg-accent/40",
                    )}
                  >
                    {photoUrls[s.id] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrls[s.id]} alt="" width={64} height={64} className="size-16 shrink-0 rounded-xl object-cover" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-semibold">{s.name}</span>
                        <span className="shrink-0 font-semibold">
                          {many && <span className="text-xs font-normal text-muted-foreground">dès </span>}
                          {formatEuros(lowestPrice(s))}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> {formatDuration(s.duration_minutes)}</span>
                        {s.places.map((p) => (
                          <span key={p.place} className="inline-flex items-center gap-1">
                            {p.place === "home" ? <Home className="size-3.5" /> : <Store className="size-3.5" />} {PLACE_LABELS[p.place]}
                          </span>
                        ))}
                      </span>
                      {s.description && <span className="line-clamp-3 text-sm text-muted-foreground">{s.description}</span>}
                      {s.extra_fee_cents > 0 && s.extra_fee_label && (
                        <span className="text-xs text-muted-foreground">Inclut : {s.extra_fee_label} ({formatEuros(s.extra_fee_cents)})</span>
                      )}
                      {deposit && (
                        <span className="mt-1 flex items-start gap-1.5 rounded-lg bg-secondary px-2.5 py-2 text-xs text-foreground">
                          <Lock className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            <strong>{depositDescription(s, depositKind)}.</strong> {DEPOSIT_UNAVAILABLE_MESSAGE}
                          </span>
                        </span>
                      )}
                      {!deposit && requiresDeposit(s) && (
                        <span className="text-xs font-medium text-foreground">{depositDescription(s, depositKind)} à régler en ligne à la réservation</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </section>
      )}

      {/* Étape 2 — Lieu */}
      {step === 1 && service && askAddress && place === "home" && (
        <AddressStep
          service={service}
          initial={{ line1: contact.address_line1, postalCode: contact.postal_code, city: contact.city }}
          check={(a) => checkHomeAddressAction({ slug: page.business.slug, serviceId: service.id, ...a })}
          contactLine={[page.business.phone, page.business.email].filter(Boolean).join(" · ")}
          onVerified={(res, a) => {
            setAddressCheck(res);
            setContact((c) => ({ ...c, address_line1: a.line1, postal_code: res.postcode, city: res.city ?? a.city }));
            setStartsAt(null);
            setAskAddress(false);
            setStep(2);
          }}
          onBack={() => {
            setAskAddress(false);
            if (service.places.length === 1) setStep(0);
          }}
        />
      )}

      {step === 1 && service && !(askAddress && place === "home") && (
        <section aria-labelledby="step-place" className="flex flex-col gap-4">
          <h2 id="step-place" className="text-lg font-bold">Où souhaitez-vous votre rendez-vous ?</h2>
          <p className="text-sm text-muted-foreground">{service.name}</p>
          {service.places.map((p) => (
            <button
              key={p.place}
              type="button"
              onClick={() => {
                setPlace(p.place);
                setStartsAt(null);
                if (p.place === "home" && travelOn) {
                  setAskAddress(true);
                  return;
                }
                setStep(2);
              }}
              className={cn("flex items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-accent/40", place === p.place ? "border-primary" : "border-border")}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                {p.place === "home" ? <Home className="size-5" /> : <Store className="size-5" />}
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{PLACE_LABELS[p.place]}</span>
                <span className="block text-sm text-muted-foreground">
                  {p.place === "salon" ? formatAddress(page.salon) || "À l'institut" : travelOn ? "La professionnelle se déplace chez vous · frais de déplacement calculés selon votre adresse" : "La professionnelle se déplace chez vous"}
                </span>
              </span>
              <span className="font-semibold">{formatEuros(p.price_cents)}</span>
            </button>
          ))}
        </section>
      )}

      {/* Étape 3 — Créneau */}
      {step === 2 && service && place && (
        <section aria-labelledby="step-slot" className="flex flex-col gap-4">
          <div>
            <h2 id="step-slot" className="text-lg font-bold">Choisissez un créneau</h2>
            <p className="text-sm text-muted-foreground">
              {service.name} · {PLACE_LABELS[place]} · {formatDuration(service.duration_minutes)}
            </p>
            {place === "home" && travelOn && addressCheck && (
              <p className="mt-1 text-xs text-muted-foreground">
                Créneaux compatibles avec les trajets de la professionnelle jusqu&apos;à {addressCheck.label}.{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => { setAskAddress(true); setStep(1); }}>Changer d&apos;adresse</button>
              </p>
            )}
          </div>
          {state.slotUnavailable && state.error && <FormAlert type="error">{state.error}</FormAlert>}
          <SlotPicker
            slug={page.business.slug}
            serviceId={service.id}
            place={place}
            timeZone={tz}
            today={today}
            lastDay={lastDay}
            selected={startsAt}
            refreshKey={refreshKey}
            staticDays={preview?.days}
            geo={place === "home" && travelOn ? addressCheck?.geo : undefined}
            onSelect={(iso) => {
              setStartsAt(iso);
              setStep(3);
            }}
          />
        </section>
      )}

      {/* Étapes 4 et 5 : un seul formulaire, pour que la confirmation envoie tout */}
      <form action={formAction} className={cn(step < 3 && "hidden")} noValidate>
        <input type="hidden" name="slug" value={page.business.slug} />
        <input type="hidden" name="service_id" value={serviceId ?? ""} />
        <input type="hidden" name="place" value={place ?? ""} />
        <input type="hidden" name="starts_at" value={startsAt ?? ""} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        <input type="hidden" name="rendered_at" value={renderedAt} />
        <input type="hidden" name="geo" value={place === "home" && travelOn && addressCheck ? JSON.stringify(addressCheck.geo) : ""} />
        {/* Piège à robots : invisible et ignoré par les humains */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Site web
            <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        <section aria-labelledby="step-contact" className={cn("flex flex-col gap-4", step !== 3 && "hidden")}>
          <h2 id="step-contact" className="text-lg font-bold">Vos coordonnées</h2>
          <p className="-mt-2 text-sm text-muted-foreground">Aucun compte n&apos;est nécessaire.</p>
          {state.error && step === 3 && !state.slotUnavailable && <FormAlert type="error">{state.error}</FormAlert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Prénom" name="first_name" value={contact.first_name} onChange={set("first_name")} error={errors.first_name} autoComplete="given-name" />
            <TextInput label="Nom" name="last_name" value={contact.last_name} onChange={set("last_name")} error={errors.last_name} autoComplete="family-name" />
          </div>
          <TextInput label="Email" name="email" type="email" inputMode="email" value={contact.email} onChange={set("email")} error={errors.email} autoComplete="email" hint="La confirmation vous sera envoyée à cette adresse." />
          <TextInput label="Téléphone" name="phone" type="tel" inputMode="tel" value={contact.phone} onChange={set("phone")} error={errors.phone} autoComplete="tel" />
          {place === "home" && travelOn && addressCheck && (
            <fieldset className="flex flex-col gap-3 rounded-2xl border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Adresse du rendez-vous (vérifiée)</legend>
              <p className="text-sm">{contact.address_line1}, {contact.postal_code} {contact.city}</p>
              <input type="hidden" name="address_line1" value={contact.address_line1} />
              <input type="hidden" name="postal_code" value={contact.postal_code} />
              <input type="hidden" name="city" value={contact.city} />
              <TextInput label="Complément (étage, code…)" name="address_line2" value={contact.address_line2} onChange={set("address_line2")} error={errors.address_line2} autoComplete="address-line2" />
              <button type="button" className="self-start text-xs underline underline-offset-2" onClick={() => { setAskAddress(true); setStep(1); }}>Modifier l&apos;adresse</button>
            </fieldset>
          )}
          {place === "home" && !(travelOn && addressCheck) && (
            <fieldset className="flex flex-col gap-4 rounded-2xl border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Adresse du rendez-vous</legend>
              <TextInput label="Adresse" name="address_line1" value={contact.address_line1} onChange={set("address_line1")} error={errors.address_line1} autoComplete="address-line1" />
              <TextInput label="Complément (étage, code…)" name="address_line2" value={contact.address_line2} onChange={set("address_line2")} error={errors.address_line2} autoComplete="address-line2" />
              <div className="grid grid-cols-[8rem_1fr] gap-3">
                <TextInput label="Code postal" name="postal_code" inputMode="numeric" value={contact.postal_code} onChange={set("postal_code")} error={errors.postal_code} autoComplete="postal-code" />
                <TextInput label="Ville" name="city" value={contact.city} onChange={set("city")} error={errors.city} autoComplete="address-level2" />
              </div>
            </fieldset>
          )}
          {place !== "home" && (
            <>
              <input type="hidden" name="address_line1" value="" />
              <input type="hidden" name="postal_code" value="" />
              <input type="hidden" name="city" value="" />
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="comment">Commentaire (facultatif)</Label>
            <Textarea id="comment" name="comment" maxLength={1000} value={contact.comment} onChange={set("comment")} placeholder="Une précision utile pour la professionnelle" />
            {errors.comment && <FieldError>{errors.comment}</FieldError>}
          </div>
          <Conditions page={page} />
          <div>
            <Checkbox
              name="accept_terms"
              checked={contact.accept_terms}
              onChange={set("accept_terms")}
              label="J'accepte les conditions de réservation et d'annulation"
              aria-invalid={errors.accept_terms ? true : undefined}
            />
            {errors.accept_terms && <FieldError>{errors.accept_terms}</FieldError>}
          </div>
          <Button type="button" size="lg" onClick={() => validateContact() && setStep(4)}>
            Continuer
          </Button>
        </section>

        {/* Étape 5 — Récapitulatif */}
        {step === 4 && service && place && startsAt && (
          <section aria-labelledby="step-summary" className="flex flex-col gap-4">
            <h2 id="step-summary" className="text-lg font-bold">Vérifiez votre réservation</h2>
            {state.error && !state.slotUnavailable && <FormAlert type="error">{state.error}</FormAlert>}
            <dl className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
              <SummaryRow label="Prestation" value={service.name} />
              <SummaryRow label="Date" value={timeFmt.format(new Date(startsAt))} capitalize />
              <SummaryRow label="Durée" value={formatDuration(service.duration_minutes)} />
              <SummaryRow
                label="Lieu"
                value={place === "home" ? `À domicile — ${formatAddress({ line1: contact.address_line1, line2: contact.address_line2, postal_code: contact.postal_code, city: contact.city })}` : `En institut${page.salon ? ` — ${formatAddress(page.salon)}` : ""}`}
              />
              {place === "home" && travelOn && addressCheck ? (
                <>
                  <SummaryRow label="Prix de la prestation" value={formatEuros(addressCheck.serviceCents)} />
                  <SummaryRow label="Déplacement" value={addressCheck.feeCents > 0 ? `${formatEuros(addressCheck.feeCents)} (${addressCheck.distanceKm.toString().replace(".", ",")} km${addressCheck.zoneName ? ` · ${addressCheck.zoneName}` : ""})` : "Offert"} />
                  <SummaryRow label="Total" value={formatEuros(addressCheck.serviceCents + addressCheck.feeCents)} strong />
                </>
              ) : (
                <SummaryRow label="Prix" value={price != null ? formatEuros(price) : "—"} strong />
              )}
              {depositNow > 0 ? (
                <>
                  <SummaryRow label={`${DEPOSIT_KIND_LABEL[depositKind]} à payer maintenant`} value={formatEuros(depositNow)} strong />
                  <SummaryRow label="Reste à régler sur place" value={formatEuros(totalNow - depositNow)} />
                </>
              ) : (
                <SummaryRow label="Acompte" value="Aucun paiement demandé à la réservation" />
              )}
              <SummaryRow label="Annulation" value={page.settings.customer_can_cancel ? (noticeHours > 0 ? `Possible en ligne jusqu'à ${noticeHours} h avant` : "Possible en ligne jusqu'au rendez-vous") : "Contactez la professionnelle"} />
              <SummaryRow label="Vos coordonnées" value={`${contact.first_name} ${contact.last_name} · ${contact.email} · ${contact.phone}`} />
            </dl>
            {page.settings.cancellation_policy && <p className="whitespace-pre-line text-xs text-muted-foreground">{page.settings.cancellation_policy}</p>}
            {depositNow > 0 && (
              <p className="whitespace-pre-line rounded-xl bg-secondary p-3 text-xs text-foreground">{page.payment?.deposit_terms || defaultDepositTerms(depositKind)}</p>
            )}
            {isDemo && <FormAlert type="info">Démonstration : la réservation sera enregistrée dans l&apos;agenda de démonstration et la confirmation sera simulée (aucun email réel){depositNow > 0 ? " ; le paiement passe par Stripe en mode test (carte de test 4242 4242 4242 4242, aucun débit réel)" : ""}.</FormAlert>}
            <SubmitButton size="lg" pendingLabel={depositNow > 0 ? "Ouverture du paiement sécurisé…" : "Confirmation en cours…"}>
              {depositNow > 0 ? <><Lock /> Payer {formatEuros(depositNow)} et réserver</> : <><Check /> Confirmer le rendez-vous</>}
            </SubmitButton>
            <p className="text-center text-xs text-muted-foreground">
              {depositNow > 0
                ? "Paiement sécurisé par Stripe : le créneau est réservé 35 minutes pendant le paiement et le rendez-vous n'est confirmé qu'après validation du paiement."
                : "Le créneau est vérifié une dernière fois au moment de la confirmation."}
            </p>
          </section>
        )}
      </form>
    </div>
  );
}

function TextInput({ label, name, error, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined} {...props} />
      {hint && !error && (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${name}-error`}>{error}</FieldError>}
    </div>
  );
}

function SummaryRow({ label, value, strong, capitalize }: { label: string; value: string; strong?: boolean; capitalize?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="text-muted-foreground sm:w-32 sm:shrink-0">{label}</dt>
      <dd className={cn(strong && "font-semibold", capitalize && "first-letter:uppercase")}>{value}</dd>
    </div>
  );
}

export function Conditions({ page }: { page: PublicPage }) {
  const { settings } = page;
  if (!settings.booking_terms && !settings.cancellation_policy && !settings.customer_can_cancel) return null;
  return (
    <details className="rounded-2xl bg-secondary px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold">Conditions de réservation et d&apos;annulation</summary>
      <div className="mt-2 flex flex-col gap-2 whitespace-pre-line text-muted-foreground">
        <p>
          {settings.customer_can_cancel || settings.customer_can_reschedule
            ? `Vous pourrez ${[settings.customer_can_cancel && "annuler", settings.customer_can_reschedule && "déplacer"].filter(Boolean).join(" ou ")} votre rendez-vous en ligne jusqu'à ${settings.cancellation_notice_hours} h avant, grâce au lien reçu par email.`
            : "Pour annuler ou déplacer votre rendez-vous, contactez directement la professionnelle."}
        </p>
        {settings.cancellation_policy && <p>{settings.cancellation_policy}</p>}
        {settings.booking_terms && <p>{settings.booking_terms}</p>}
      </div>
    </details>
  );
}
