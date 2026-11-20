"use client";

import { useActionState } from "react";
import { FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveBookingSettingsAction } from "@/server/actions/booking-settings";
import type { FormState } from "@/lib/validation/auth";

export interface BookingSettingsDefaults {
  booking_enabled: boolean;
  slug: string;
  public_description: string;
  public_phone: string;
  public_email: string;
  public_instagram: string;
  cancellation_policy: string;
  booking_terms: string;
  cancellation_notice_hours: number;
  customer_can_cancel: boolean;
  customer_can_reschedule: boolean;
  booking_window_days: number;
  slot_step_minutes: number;
  notification_email: string;
  coverUrl: string | null;
  defaultNotificationEmail: string | null;
}

export function BookingSettingsForm({ defaults, siteUrl }: { defaults: BookingSettingsDefaults; siteUrl: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(saveBookingSettingsAction, {});
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  const val = (k: keyof BookingSettingsDefaults) => (v?.[k] ?? String(defaults[k] ?? ""));
  const checked = (k: "booking_enabled" | "customer_can_cancel" | "customer_can_reschedule") => (v ? v[k] === "on" : defaults[k]);

  return (
    <form action={formAction} className="flex flex-col gap-6" key={JSON.stringify(v ?? {})}>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}

      <section className="flex flex-col gap-4">
        <Checkbox
          name="booking_enabled"
          defaultChecked={checked("booking_enabled")}
          label="Activer ma page de réservation en ligne"
          hint="Tant qu'elle est désactivée, personne ne peut réserver en ligne."
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slug">Adresse de la page</Label>
          <div className="flex items-center overflow-hidden rounded-xl border border-input bg-card focus-within:border-ring">
            <span className="hidden shrink-0 bg-secondary px-3 py-3 text-sm text-muted-foreground sm:block">{siteUrl.replace(/^https?:\/\//, "")}/reserver/</span>
            <input id="slug" name="slug" defaultValue={val("slug")} className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none" aria-invalid={fe.slug ? true : undefined} autoCapitalize="none" spellCheck={false} />
          </div>
          {fe.slug ? <FieldError>{fe.slug}</FieldError> : <p className="text-xs text-muted-foreground">Lettres minuscules, chiffres et tirets. Si vous la changez, l&apos;ancien lien ne fonctionnera plus.</p>}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Présentation</h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="public_description">Présentation de votre activité</Label>
          <Textarea id="public_description" name="public_description" maxLength={2000} defaultValue={val("public_description")} placeholder="Ex. : Esthéticienne diplômée, soins visage et beauté des mains à domicile autour de Toulouse et dans mon institut de Colomiers." />
          {fe.public_description && <FieldError>{fe.public_description}</FieldError>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cover">Photo de couverture</Label>
          {defaults.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={defaults.coverUrl} alt="Couverture actuelle" className="h-24 w-full max-w-md rounded-xl border border-border object-cover" />
          )}
          <Input id="cover" name="cover" type="file" accept="image/png,image/jpeg,image/webp" aria-invalid={fe.cover ? true : undefined} />
          {fe.cover ? <FieldError>{fe.cover}</FieldError> : <p className="text-xs text-muted-foreground">PNG, JPEG ou WebP, 2 Mo maximum. Format paysage conseillé.</p>}
          {defaults.coverUrl && <Checkbox name="remove_cover" label="Retirer la photo de couverture" />}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Coordonnées affichées</h3>
        <p className="-mt-2 text-sm text-muted-foreground">Visibles par tout le monde sur votre page. Laissez vide pour ne rien afficher.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Téléphone" name="public_phone" type="tel" value={val("public_phone")} error={fe.public_phone} />
          <TextField label="Email" name="public_email" type="email" value={val("public_email")} error={fe.public_email} />
        </div>
        <TextField label="Instagram" name="public_instagram" value={val("public_instagram")} error={fe.public_instagram} placeholder="mon.institut" />
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Règles de réservation</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking_window_days">Réservation possible jusqu&apos;à</Label>
            <Select id="booking_window_days" name="booking_window_days" defaultValue={val("booking_window_days")}>
              {[14, 30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>{d} jours à l&apos;avance</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slot_step_minutes">Créneaux proposés toutes les</Label>
            <Select id="slot_step_minutes" name="slot_step_minutes" defaultValue={val("slot_step_minutes")}>
              {[5, 10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Le délai minimum avant un rendez-vous se règle dans chaque prestation.</p>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Annulation et modification par la cliente</h3>
        <Checkbox name="customer_can_cancel" defaultChecked={checked("customer_can_cancel")} label="Autoriser l'annulation en ligne" />
        <Checkbox name="customer_can_reschedule" defaultChecked={checked("customer_can_reschedule")} label="Autoriser le déplacement en ligne" />
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="cancellation_notice_hours">Jusqu&apos;à combien d&apos;heures avant ?</Label>
          <Input id="cancellation_notice_hours" name="cancellation_notice_hours" type="number" min={0} max={720} defaultValue={val("cancellation_notice_hours")} aria-invalid={fe.cancellation_notice_hours ? true : undefined} />
          {fe.cancellation_notice_hours && <FieldError>{fe.cancellation_notice_hours}</FieldError>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancellation_policy">Politique d&apos;annulation</Label>
          <Textarea id="cancellation_policy" name="cancellation_policy" maxLength={2000} defaultValue={val("cancellation_policy")} placeholder="Ex. : Merci de prévenir au moins 24 h à l'avance. Au-delà, le rendez-vous pourra être dû." />
          {fe.cancellation_policy && <FieldError>{fe.cancellation_policy}</FieldError>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="booking_terms">Conditions de réservation</Label>
          <Textarea id="booking_terms" name="booking_terms" maxLength={10000} defaultValue={val("booking_terms")} placeholder="Ex. : Merci d'arriver 5 minutes avant. Les soins sont déconseillés aux femmes enceintes sans avis médical." />
          {fe.booking_terms && <FieldError>{fe.booking_terms}</FieldError>}
        </div>
        <p className="text-xs text-muted-foreground">Les règles en vigueur au moment de la réservation restent celles de la cliente, même si vous les modifiez ensuite.</p>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Notifications</h3>
        <TextField
          label="Recevoir les alertes de réservation à"
          name="notification_email"
          type="email"
          value={val("notification_email")}
          error={fe.notification_email}
          placeholder={defaults.defaultNotificationEmail ?? "votre@email.fr"}
          hint={defaults.defaultNotificationEmail ? `Laissez vide pour utiliser ${defaults.defaultNotificationEmail}.` : "Aucun email professionnel renseigné : indiquez une adresse pour être prévenue."}
        />
      </section>

      <SubmitButton className="self-start" pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
    </form>
  );
}

function TextField({ label, name, value, error, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; value: string; error?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={value} aria-invalid={error ? true : undefined} {...props} />
      {error ? <FieldError>{error}</FieldError> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
