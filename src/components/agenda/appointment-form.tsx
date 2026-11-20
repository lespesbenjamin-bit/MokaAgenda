"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Home, Search, Store, UserPlus, Users } from "lucide-react";
import { Field, FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { createAppointmentAction, customerAddressesAction, updateAppointmentAction, type AppointmentFormState } from "@/server/actions/agenda";
import { centsToInput, formatDuration, formatEuros, type Place } from "@/lib/domain/pricing";
import { normalizeName, normalizePhone } from "@/lib/domain/customers";
import { cn } from "@/lib/utils";

export interface BookableService {
  id: string;
  name: string;
  category: string | null;
  durationMinutes: number;
  mobilizedMinutes: number;
  prices: Partial<Record<Place, number>>; // prix TTC total par lieu proposé
}

export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

interface AddressOption {
  id: string;
  label: string | null;
  kind: string;
  line1: string;
  line2: string | null;
  postal_code: string | null;
  city: string;
  is_primary: boolean;
}

export interface AppointmentFormDefaults {
  id?: string;
  customerId: string;
  customerName?: string;
  serviceId: string;
  place: Place | "";
  date: string;
  time: string;
  duration: string;
  price: string;
  addressId: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  notes: string;
}

const PLACE_LABEL: Record<Place, string> = { salon: "En institut", home: "À domicile" };

export function AppointmentForm({
  defaults,
  services,
  customers,
  allowedPlaces,
}: {
  defaults: AppointmentFormDefaults;
  services: BookableService[];
  customers: CustomerOption[];
  allowedPlaces: Place[];
}) {
  const isEdit = Boolean(defaults.id);
  const [state, formAction] = useActionState<AppointmentFormState, FormData>(isEdit ? updateAppointmentAction : createAppointmentAction, {});
  const v = state.values;
  const fe = state.fieldErrors ?? {};

  const [customerMode, setCustomerMode] = useState<"existing" | "new">(v?.customer_mode === "new" ? "new" : "existing");
  const [customerId, setCustomerId] = useState(v?.customer_id ?? defaults.customerId);
  const [query, setQuery] = useState("");
  const [serviceId, setServiceId] = useState(v?.service_id ?? defaults.serviceId);
  const service = services.find((s) => s.id === serviceId);
  const servicePlaces = useMemo(
    () => (service ? (Object.keys(service.prices) as Place[]).filter((p) => allowedPlaces.includes(p)) : allowedPlaces),
    [service, allowedPlaces],
  );
  const [chosenPlace, setPlace] = useState<Place | "">((v?.place as Place) ?? defaults.place);
  // Lieu effectif : toujours cohérent avec la prestation choisie
  const place: Place | "" = chosenPlace && servicePlaces.includes(chosenPlace) ? chosenPlace : servicePlaces.length === 1 ? servicePlaces[0] : "";
  const [duration, setDuration] = useState(v?.duration_minutes ?? defaults.duration);
  const [price, setPrice] = useState(v?.price ?? defaults.price);
  const [time, setTime] = useState(v?.time ?? defaults.time);
  const [loadedAddresses, setAddresses] = useState<{ customerId: string; list: AddressOption[] }>({ customerId: "", list: [] });
  const [addressChoice, setAddressChoice] = useState(v?.address_choice ?? defaults.addressId);
  const [addr, setAddr] = useState({
    line1: v?.address_line1 ?? defaults.addressLine1,
    line2: v?.address_line2 ?? defaults.addressLine2,
    postal: v?.postal_code ?? defaults.postalCode,
    city: v?.city ?? defaults.city,
  });

  // Adresses de la cliente pour un rendez-vous à domicile
  useEffect(() => {
    let cancelled = false;
    const id = isEdit ? defaults.customerId : customerMode === "existing" ? customerId : "";
    if (!id) return;
    customerAddressesAction(id).then((list) => {
      if (cancelled) return;
      setAddresses({ customerId: id, list });
      if (!isEdit && !v && list.length) {
        const primary = list.find((a) => a.is_primary) ?? list[0];
        setAddressChoice(primary.id);
        setAddr({ line1: primary.line1, line2: primary.line2 ?? "", postal: primary.postal_code ?? "", city: primary.city });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, customerMode, isEdit, v, defaults.customerId]);
  const activeCustomer = isEdit ? defaults.customerId : customerMode === "existing" ? customerId : "";
  const addresses = loadedAddresses.customerId === activeCustomer ? loadedAddresses.list : [];

  function chooseService(id: string) {
    setServiceId(id);
    const s = services.find((x) => x.id === id);
    if (!s) return;
    setDuration(String(s.durationMinutes));
    const places = (Object.keys(s.prices) as Place[]).filter((p) => allowedPlaces.includes(p));
    const nextPlace = place && places.includes(place) ? place : places[0];
    if (nextPlace) {
      setPlace(nextPlace);
      setPrice(centsToInput(s.prices[nextPlace]!));
    }
  }

  function choosePlace(p: Place) {
    setPlace(p);
    if (service?.prices[p] !== undefined) setPrice(centsToInput(service.prices[p]!));
  }

  function chooseAddress(id: string) {
    setAddressChoice(id);
    const a = addresses.find((x) => x.id === id);
    if (a) setAddr({ line1: a.line1, line2: a.line2 ?? "", postal: a.postal_code ?? "", city: a.city });
    else setAddr({ line1: "", line2: "", postal: "", city: "" });
  }

  const matches = useMemo(() => {
    const n = normalizeName(query);
    const digits = query.replace(/\D/g, "");
    if (!query.trim()) return customers.slice(0, 6);
    return customers
      .filter((c) => normalizeName(c.name).includes(n) || (digits.length >= 3 && (normalizePhone(c.phone) ?? "").includes(digits)) || (c.email ?? "").includes(query.toLowerCase()))
      .slice(0, 8);
  }, [customers, query]);
  const selectedCustomer = customers.find((c) => c.id === customerId);

  const catalogPrice = service && place ? service.prices[place] : undefined;

  return (
    <form action={formAction} className="grid items-start gap-6 lg:grid-cols-[1fr_300px]" noValidate>
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <div className="flex flex-col gap-6">
        {state.error && (
          <FormAlert type="error">
            {state.error}
            {state.suggestions && state.suggestions.length > 0 && (
              <span className="mt-2 block">
                Créneaux libres ce jour-là :{" "}
                {state.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => setTime(s)} className="mr-1.5 mt-1 inline-block rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold text-foreground ring-1 ring-border hover:ring-primary">
                    {s}
                  </button>
                ))}
              </span>
            )}
          </FormAlert>
        )}

        <Section title="Cliente">
          {isEdit ? (
            <p className="font-semibold">{defaults.customerName}</p>
          ) : (
            <>
              <input type="hidden" name="customer_mode" value={customerMode} />
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["existing", "Cliente existante", Users],
                    ["new", "Nouvelle cliente", UserPlus],
                  ] as const
                ).map(([mode, label, Icon]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCustomerMode(mode)}
                    aria-pressed={customerMode === mode}
                    className={cn("flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold", customerMode === mode ? "border-primary bg-accent" : "border-border")}
                  >
                    <Icon className="size-4" /> {label}
                  </button>
                ))}
              </div>
              {customerMode === "existing" ? (
                <div className="flex flex-col gap-2">
                  <input type="hidden" name="customer_id" value={customerId} />
                  {selectedCustomer && (
                    <p className="rounded-xl bg-accent px-3 py-2 text-sm">
                      Sélectionnée : <strong>{selectedCustomer.name}</strong>
                      {selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}
                    </p>
                  )}
                  <Label htmlFor="customer-search">Rechercher une cliente</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="customer-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou téléphone" className="pl-10" autoComplete="off" />
                  </div>
                  <ul className="flex flex-col gap-1" role="listbox" aria-label="Clientes">
                    {matches.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={customerId === c.id}
                          onClick={() => setCustomerId(c.id)}
                          className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm", customerId === c.id ? "bg-accent font-semibold" : "hover:bg-surface")}
                        >
                          <span>{c.name}</span>
                          <span className="text-xs text-muted-foreground">{c.phone ?? c.email ?? ""}</span>
                        </button>
                      </li>
                    ))}
                    {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Aucune cliente trouvée. Créez-la avec « Nouvelle cliente ».</li>}
                  </ul>
                  {fe.customer_id && <FieldError>{fe.customer_id}</FieldError>}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Prénom" name="new_first_name" defaultValue={v?.new_first_name} error={fe.new_first_name} autoComplete="off" />
                  <Field label="Nom" name="new_last_name" defaultValue={v?.new_last_name} error={fe.new_last_name} autoComplete="off" />
                  <Field label="Téléphone" name="new_phone" type="tel" defaultValue={v?.new_phone} error={fe.new_phone} autoComplete="off" />
                  <Field label="Email (facultatif)" name="new_email" type="email" defaultValue={v?.new_email} error={fe.new_email} autoComplete="off" />
                </div>
              )}
            </>
          )}
        </Section>

        <Section title="Prestation et lieu">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service_id">Prestation</Label>
            <Select id="service_id" name="service_id" value={serviceId} onChange={(e) => chooseService(e.target.value)}>
              <option value="">Choisir une prestation…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatDuration(s.durationMinutes)}
                  {s.category ? ` (${s.category})` : ""}
                </option>
              ))}
            </Select>
            {fe.service_id && <FieldError>{fe.service_id}</FieldError>}
            {services.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Aucune prestation active. <Link href="/prestations/nouvelle" className="font-semibold text-primary">Créer une prestation</Link>
              </p>
            )}
          </div>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-1.5 text-sm font-semibold">Lieu</legend>
            <input type="hidden" name="place" value={place} />
            {(["salon", "home"] as const).map((p) => {
              const Icon = p === "home" ? Home : Store;
              const available = servicePlaces.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!available}
                  onClick={() => choosePlace(p)}
                  aria-pressed={place === p}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40",
                    place === p ? (p === "home" ? "border-brand bg-accent" : "border-ink bg-secondary") : "border-border",
                  )}
                >
                  <Icon className="size-4" /> {PLACE_LABEL[p]}
                </button>
              );
            })}
          </fieldset>
          {fe.place && <FieldError>{fe.place}</FieldError>}

          {place === "home" && (
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <p className="text-sm font-semibold">Adresse d&apos;intervention</p>
              {addresses.length > 0 && (
                <Select aria-label="Adresse enregistrée" name="address_choice" value={addressChoice} onChange={(e) => chooseAddress(e.target.value)}>
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label || (a.kind === "work" ? "Travail" : a.kind === "other" ? "Autre" : "Domicile")} — {a.line1}, {a.city}
                    </option>
                  ))}
                  <option value="">Autre adresse (pour ce rendez-vous)</option>
                </Select>
              )}
              {addresses.length === 0 && <input type="hidden" name="address_choice" value="" />}
              <Field label="Adresse" name="address_line1" value={addr.line1} onChange={(e) => { setAddr({ ...addr, line1: e.target.value }); setAddressChoice(""); }} error={fe.address_line1} />
              <Field label="Complément" name="address_line2" value={addr.line2} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} />
              <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                <Field label="Code postal" name="postal_code" value={addr.postal} onChange={(e) => { setAddr({ ...addr, postal: e.target.value }); setAddressChoice(""); }} inputMode="numeric" />
                <Field label="Ville" name="city" value={addr.city} onChange={(e) => { setAddr({ ...addr, city: e.target.value }); setAddressChoice(""); }} />
              </div>
              <p className="text-xs text-muted-foreground">Distance et temps de trajet : calculés dans une prochaine version (non estimés ici).</p>
            </div>
          )}
        </Section>

        <Section title="Date et horaire">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" name="date" type="date" defaultValue={v?.date ?? defaults.date} required error={fe.date} />
            <Field label="Heure" name="time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} required error={fe.time} />
            <Field label="Durée (min)" name="duration_minutes" type="number" inputMode="numeric" min={5} max={720} value={duration} onChange={(e) => setDuration(e.target.value)} error={fe.duration_minutes} />
          </div>
          {service && service.mobilizedMinutes !== service.durationMinutes && (
            <p className="text-xs text-muted-foreground">Préparation, nettoyage et temps tampon de la prestation sont automatiquement réservés autour du rendez-vous.</p>
          )}
        </Section>

        <Section title="Prix et notes">
          <Field
            label="Prix (€)"
            name="price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            hint={catalogPrice !== undefined ? `Tarif du catalogue : ${formatEuros(catalogPrice)}. Modifier ici ne change pas votre catalogue.` : undefined}
            error={fe.price}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes_internal">Notes internes</Label>
            <Textarea id="notes_internal" name="notes_internal" defaultValue={v?.notes_internal ?? defaults.notes} maxLength={2000} placeholder="Visibles uniquement par vous." />
            {fe.notes_internal && <FieldError>{fe.notes_internal}</FieldError>}
          </div>
          {!isEdit && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Statut</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="status" value="confirmed" defaultChecked={v?.status !== "pending"} className="accent-[var(--primary)]" /> Confirmé
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="status" value="pending" defaultChecked={v?.status === "pending"} className="accent-[var(--primary)]" /> En attente de confirmation
              </label>
            </fieldset>
          )}
        </Section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button asChild variant="ghost">
            <Link href={defaults.id ? `/agenda/${defaults.id}` : "/agenda"}>Annuler</Link>
          </Button>
          <SubmitButton size="lg" pendingLabel="Vérification du créneau…">
            {isEdit ? "Enregistrer les modifications" : "Créer le rendez-vous"}
          </SubmitButton>
        </div>
      </div>

      <aside className="rounded-2xl border border-border bg-card p-5 text-sm lg:sticky lg:top-6">
        <h2 className="font-display text-lg font-bold">Récapitulatif</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
          <dt className="text-muted-foreground">Prestation</dt>
          <dd className="text-right font-medium">{service?.name ?? "—"}</dd>
          <dt className="text-muted-foreground">Lieu</dt>
          <dd className="text-right font-medium">{place ? PLACE_LABEL[place] : "—"}</dd>
          <dt className="text-muted-foreground">Durée</dt>
          <dd className="text-right font-medium">{Number(duration) > 0 ? formatDuration(Number(duration)) : "—"}</dd>
          <dt className="text-muted-foreground">Prix</dt>
          <dd className="text-right font-medium">{price ? `${price} €` : "—"}</dd>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">Le créneau est vérifié à l&apos;enregistrement : horaires, pauses, congés et autres rendez-vous.</p>
      </aside>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}
