"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  MapPin,
  Pencil,
  Plus,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox, Label, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionButton } from "@/components/ui/action-button";
import {
  addressQuickAction,
  createCustomerAction,
  saveAddressAction,
  saveConsentsAction,
  savePreferencesAction,
  updateCustomerAction,
  type CustomerFormState,
} from "@/server/actions/customers";
import {
  ADDRESS_KIND_LABELS,
  CONTACT_PREFERENCE_LABELS,
} from "@/lib/domain/customers";
import type { FormState } from "@/lib/validation/auth";

export interface CustomerIdentityDefaults {
  id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  birth_date: string;
  notes: string;
}

/** Identité de la cliente (création ou modification), avec alerte de doublons. */
export function CustomerIdentityForm({
  defaults,
}: {
  defaults: CustomerIdentityDefaults;
}) {
  const isNew = !defaults.id;
  const [state, action] = useActionState<CustomerFormState, FormData>(
    isNew ? createCustomerAction : updateCustomerAction,
    {},
  );
  const fe = state.fieldErrors ?? {};
  const v = (k: keyof CustomerIdentityDefaults) =>
    state.values?.[k] ?? defaults[k] ?? "";
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      {state.duplicates && state.duplicates.length > 0 && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning"
        >
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4" /> Cette cliente existe peut-être
            déjà
          </p>
          <ul className="flex flex-col gap-1 text-foreground">
            {state.duplicates.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/clientes/${d.id}`}
                  className="font-semibold underline"
                  target="_blank"
                >
                  {d.name}
                </Link>{" "}
                <span className="text-muted-foreground">({d.reasons})</span>
              </li>
            ))}
          </ul>
          <Checkbox
            name="confirm_duplicate"
            label={
              isNew
                ? "Il s'agit bien d'une autre personne : créer la fiche quand même"
                : "Enregistrer quand même"
            }
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Prénom"
          name="first_name"
          defaultValue={v("first_name")}
          autoComplete="off"
          error={fe.first_name}
        />
        <Field
          label="Nom"
          name="last_name"
          defaultValue={v("last_name")}
          autoComplete="off"
          error={fe.last_name}
        />
        <Field
          label="Téléphone"
          name="phone"
          type="tel"
          defaultValue={v("phone")}
          autoComplete="off"
          error={fe.phone}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          defaultValue={v("email")}
          autoComplete="off"
          error={fe.email}
        />
        <Field
          label="Date de naissance (facultative)"
          name="birth_date"
          type="date"
          defaultValue={v("birth_date")}
          error={fe.birth_date}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes professionnelles</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={v("notes")}
          maxLength={5000}
          placeholder="Ex. préfère les rendez-vous en fin de journée, digicode 1234B…"
          aria-describedby="notes-hint"
        />
        <p id="notes-hint" className="text-xs text-muted-foreground">
          N&apos;y notez pas d&apos;informations médicales ou sensibles.
        </p>
        {fe.notes && <FieldError>{fe.notes}</FieldError>}
      </div>

      {isNew && (
        <fieldset className="flex flex-col gap-4 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold">
            Adresse principale (facultative)
          </legend>
          <input type="hidden" name="kind" value="home" />
          <Field
            label="Adresse"
            name="line1"
            defaultValue={state.values?.line1 ?? ""}
            autoComplete="off"
            error={fe.line1}
          />
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <Field
              label="Code postal"
              name="postal_code"
              defaultValue={state.values?.postal_code ?? ""}
              inputMode="numeric"
              error={fe.postal_code}
            />
            <Field
              label="Ville"
              name="city"
              defaultValue={state.values?.city ?? ""}
              error={fe.city}
            />
          </div>
        </fieldset>
      )}

      <div className="flex justify-end">
        <SubmitButton size="lg" pendingLabel="Enregistrement…">
          {isNew ? "Créer la fiche" : "Enregistrer"}
        </SubmitButton>
      </div>
    </form>
  );
}

export interface AddressItem {
  id: string;
  kind: "home" | "work" | "other";
  label: string | null;
  line1: string;
  line2: string | null;
  postal_code: string | null;
  city: string;
  is_primary: boolean;
  geocoded: boolean;
}

export function AddressesManager({
  customerId,
  addresses,
}: {
  customerId: string;
  addresses: AddressItem[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(addresses.length === 0);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="addr-title">
      <div className="flex items-center justify-between">
        <h2 id="addr-title" className="font-display text-lg font-bold">
          Adresses
        </h2>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus /> Ajouter
          </Button>
        )}
      </div>
      {addresses.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">Aucune adresse.</p>
      )}
      <ul className="flex flex-col gap-2">
        {addresses.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AddressForm
                customerId={customerId}
                address={a}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={a.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex min-w-0 gap-2.5 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {a.label || ADDRESS_KIND_LABELS[a.kind]}
                    {a.is_primary && (
                      <Badge variant="default">Principale</Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {a.line1}
                    {a.line2 ? `, ${a.line2}` : ""} —{" "}
                    {a.postal_code ? `${a.postal_code} ` : ""}
                    {a.city}
                  </p>
                  {!a.geocoded && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Position GPS non vérifiée (calcul des trajets à venir)
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 border-t border-border pt-3">
                {!a.is_primary && (
                  <ActionButton
                    action={addressQuickAction}
                    fields={{
                      customer_id: customerId,
                      address_id: a.id,
                      op: "primary",
                    }}
                  >
                    <Star /> Définir principale
                  </ActionButton>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(a.id)}
                  aria-label="Modifier l'adresse"
                >
                  <Pencil />
                </Button>
                <ActionButton
                  action={addressQuickAction}
                  fields={{
                    customer_id: customerId,
                    address_id: a.id,
                    op: "delete",
                  }}
                  ariaLabel="Supprimer l'adresse"
                  confirm={{
                    title: "Supprimer cette adresse ?",
                    description: `${a.line1}, ${a.city}`,
                    confirmLabel: "Supprimer",
                  }}
                >
                  <Trash2 />
                </ActionButton>
              </div>
            </li>
          ),
        )}
      </ul>
      {adding && (
        <AddressForm
          customerId={customerId}
          canBePrimary={addresses.length > 0}
          onDone={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function AddressForm({
  customerId,
  address,
  canBePrimary,
  onDone,
}: {
  customerId: string;
  address?: AddressItem;
  canBePrimary?: boolean;
  onDone: () => void;
}) {
  const [state, action] = useActionState(
    async (prev: FormState, fd: FormData) => {
      const r = await saveAddressAction(prev, fd);
      if (r.success) onDone();
      return r;
    },
    {},
  );
  const fe = state.fieldErrors ?? {};
  const v = (k: string, d: string | null | undefined) =>
    state.values?.[k] ?? d ?? "";
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-xl border border-primary/40 bg-card p-4"
      noValidate
    >
      <input type="hidden" name="customer_id" value={customerId} />
      {address && <input type="hidden" name="address_id" value={address.id} />}
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`kind-${address?.id ?? "new"}`}>Type</Label>
          <Select
            id={`kind-${address?.id ?? "new"}`}
            name="kind"
            defaultValue={v("kind", address?.kind ?? "home")}
          >
            {Object.entries(ADDRESS_KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <Field
          label="Libellé (facultatif)"
          name="label"
          id={`label-${address?.id ?? "new"}`}
          defaultValue={v("label", address?.label)}
          placeholder="Ex. chez sa mère"
          error={fe.label}
        />
      </div>
      <Field
        label="Adresse"
        name="line1"
        id={`line1-${address?.id ?? "new"}`}
        defaultValue={v("line1", address?.line1)}
        error={fe.line1}
      />
      <Field
        label="Complément (facultatif)"
        name="line2"
        id={`line2-${address?.id ?? "new"}`}
        defaultValue={v("line2", address?.line2)}
        placeholder="Bâtiment, étage, digicode"
        error={fe.line2}
      />
      <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
        <Field
          label="Code postal"
          name="postal_code"
          id={`pc-${address?.id ?? "new"}`}
          defaultValue={v("postal_code", address?.postal_code)}
          inputMode="numeric"
          error={fe.postal_code}
        />
        <Field
          label="Ville"
          name="city"
          id={`city-${address?.id ?? "new"}`}
          defaultValue={v("city", address?.city)}
          error={fe.city}
        />
      </div>
      {!address && canBePrimary && (
        <Checkbox name="is_primary" label="Définir comme adresse principale" />
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <SubmitButton pendingLabel="Enregistrement…">
          {address ? "Enregistrer" : "Ajouter l'adresse"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function PreferencesForm({
  customerId,
  contactPreference,
  preferences,
}: {
  customerId: string;
  contactPreference: string;
  preferences: string;
}) {
  const [state, action] = useActionState(savePreferencesAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="id" value={customerId} />
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact_preference">Moyen de contact préféré</Label>
        <Select
          id="contact_preference"
          name="contact_preference"
          defaultValue={state.values?.contact_preference ?? contactPreference}
        >
          {Object.entries(CONTACT_PREFERENCE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="preferences">Préférences</Label>
        <Textarea
          id="preferences"
          name="preferences"
          defaultValue={state.values?.preferences ?? preferences}
          maxLength={2000}
          placeholder="Ex. couleurs de vernis favorites, musique douce, thé plutôt que café…"
          aria-describedby="pref-hint"
        />
        <p id="pref-hint" className="text-xs text-muted-foreground">
          Uniquement des informations utiles au suivi, jamais de données
          médicales ou sensibles.
        </p>
        {state.fieldErrors?.preferences && (
          <FieldError>{state.fieldErrors.preferences}</FieldError>
        )}
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});

export function ConsentsForm({
  customerId,
  consents,
}: {
  customerId: string;
  consents: {
    channel: "email" | "sms";
    granted: boolean;
    recorded_at: string;
  }[];
}) {
  const [state, action] = useActionState(saveConsentsAction, {});
  const get = (ch: "email" | "sms") => consents.find((c) => c.channel === ch);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="id" value={customerId} />
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
      <p className="text-sm text-muted-foreground">
        Cochez uniquement si la cliente a donné son accord pour recevoir vos
        offres et actualités. Les messages liés à ses rendez-vous (confirmation,
        rappel) ne nécessitent pas ce consentement.
      </p>
      {(["email", "sms"] as const).map((ch) => {
        const c = get(ch);
        return (
          <div key={ch} className="rounded-xl border border-border p-4">
            <Checkbox
              name={`consent_${ch}`}
              defaultChecked={c?.granted ?? false}
              label={`Accepte les communications marketing par ${ch === "email" ? "email" : "SMS"}`}
            />
            <p className="mt-2 pl-7 text-xs text-muted-foreground">
              {c
                ? `${c.granted ? "Accord" : "Refus"} enregistré le ${dateTimeFmt.format(new Date(c.recorded_at))}`
                : "Aucun choix enregistré : la cliente ne sera pas sollicitée."}
            </p>
          </div>
        );
      })}
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Enregistrement…">
          Enregistrer les consentements
        </SubmitButton>
      </div>
    </form>
  );
}
