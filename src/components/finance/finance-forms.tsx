"use client";

import { useActionState, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw } from "lucide-react";
import { Field, FieldError } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox, Label, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionButton } from "@/components/ui/action-button";
import {
  addAdjustmentAction,
  archiveExpenseAction,
  connectStripeAction,
  recordManualPaymentAction,
  refreshStripeAction,
  refundAction,
  saveExpenseAction,
  saveFinancialSettingsAction,
  saveGoalsAction,
  stripeDashboardAction,
  validatePaymentAction,
} from "@/server/actions/finance";
import type { FormState } from "@/lib/validation/auth";
import { bpsToInput } from "@/lib/validation/finance";
import { centsToInput, formatEuros } from "@/lib/domain/pricing";
import { defaultDepositTerms } from "@/lib/domain/public-booking";
import type { FixedExpense, Goals } from "@/lib/domain/finance";

function Alerts({ state }: { state: FormState }) {
  return (
    <>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      {state.success && <FormAlert type="success">{state.success}</FormAlert>}
    </>
  );
}

function SelectField({ label, name, value, options, error, hint }: { label: string; name: string; value: string; options: [string, string][]; error?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Select id={name} name={name} defaultValue={value}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </Select>
      {error ? <FieldError>{error}</FieldError> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const REGIME_LABELS: Record<string, string> = {
  not_set: "Non renseigné",
  micro_bic_services: "Micro-entreprise — prestations de services (BIC)",
  micro_bnc: "Micro-entreprise — activité libérale (BNC)",
  micro_bic_sales: "Micro-entreprise — vente de marchandises (BIC)",
  ei_real: "Entreprise individuelle au réel",
  company: "Société (SARL, SASU…)",
  other: "Autre",
};

// ─── Paramètres financiers ──────────────────────────────────────────
export function FinancialSettingsForm({ d }: { d: { activity_regime: string; vat_status: string; contribution_rate_bps: number; contribution_base: string; tax_provision_rate_bps: number; tax_provision_base: string; deposit_kind: "arrhes" | "acompte"; deposit_terms: string | null } }) {
  const [state, action] = useActionState(saveFinancialSettingsAction, {});
  const v = (k: string, fallback: string) => state.values?.[k] ?? fallback;
  const e = state.fieldErrors ?? {};
  const [kind, setKind] = useState(d.deposit_kind);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Alerts state={state} />
      <SelectField label="Régime d'activité" name="activity_regime" value={v("activity_regime", d.activity_regime)} options={Object.entries(REGIME_LABELS)} error={e.activity_regime} />
      <SelectField
        label="Statut de TVA"
        name="vat_status"
        value={v("vat_status", d.vat_status)}
        options={[["not_set", "Non renseigné (taux saisis sur chaque prestation)"], ["franchise", "Franchise en base : TVA non applicable"], ["liable", "Assujettie à la TVA (taux de chaque prestation)"]]}
        error={e.vat_status}
        hint="En franchise, le CA HT est égal au CA TTC. Assujettie, la TVA collectée est séparée et n'est jamais comptée comme un revenu."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Taux de cotisations sociales estimé (%)" name="contribution_rate" inputMode="decimal" defaultValue={v("contribution_rate", bpsToInput(d.contribution_rate_bps))} error={e.contribution_rate} hint="Votre taux réel : voir votre espace URSSAF ou votre comptable." />
        <SelectField label="Appliqué sur" name="contribution_base" value={v("contribution_base", d.contribution_base)} options={[["revenue", "le CA HT (micro)"], ["profit", "le résultat estimé"]]} error={e.contribution_base} />
        <Field label="Provision fiscale indicative (%)" name="tax_provision_rate" inputMode="decimal" defaultValue={v("tax_provision_rate", bpsToInput(d.tax_provision_rate_bps))} error={e.tax_provision_rate} hint="Montant mis de côté pour l'impôt (ex. versement libératoire)." />
        <SelectField label="Appliquée sur" name="tax_provision_base" value={v("tax_provision_base", d.tax_provision_base)} options={[["revenue", "le chiffre d'affaires HT"], ["profit", "le résultat estimé"]]} error={e.tax_provision_base} />
      </div>
      <FormAlert type="info">
        Aucun taux n&apos;est imposé : les règles sociales et fiscales dépendent de votre statut et de votre situation. Les montants calculés sont des estimations de gestion, pas une déclaration ni une donnée comptable certifiée.
      </FormAlert>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-semibold">Paiement demandé à la réservation en ligne</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deposit_kind">Nature de la somme versée</Label>
          <Select id="deposit_kind" name="deposit_kind" value={kind} onChange={(ev) => setKind(ev.target.value as "arrhes" | "acompte")}>
            <option value="arrhes">Arrhes (ce que la loi prévoit par défaut)</option>
            <option value="acompte">Acompte</option>
          </Select>
          <p className="text-xs text-muted-foreground">Arrhes : la cliente peut renoncer en les perdant ; si vous annulez, vous lui devez le double. Acompte : engagement ferme des deux côtés. Vos conditions sont à faire valider par un professionnel du droit.</p>
          {e.deposit_kind && <FieldError>{e.deposit_kind}</FieldError>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deposit_terms">Texte affiché avant le paiement (facultatif)</Label>
          <Textarea id="deposit_terms" name="deposit_terms" maxLength={2000} defaultValue={v("deposit_terms", d.deposit_terms ?? "")} placeholder={defaultDepositTerms(kind)} />
          <p className="text-xs text-muted-foreground">Laissé vide, le texte grisé du champ est affiché à la cliente. Il est enregistré dans chaque réservation.</p>
          {e.deposit_terms && <FieldError>{e.deposit_terms}</FieldError>}
        </div>
      </div>
      <SubmitButton pendingLabel="Enregistrement…" className="self-start">Enregistrer</SubmitButton>
    </form>
  );
}

// ─── Charges fixes ──────────────────────────────────────────────────
export const EXPENSE_LABELS: Record<string, string> = { rent: "Loyer", insurance: "Assurance professionnelle", software: "Logiciels", phone: "Téléphone", subscription: "Abonnements", bank: "Banque", other: "Autre" };
export const FREQ_LABELS: Record<string, string> = { monthly: "par mois", quarterly: "par trimestre", yearly: "par an" };

export function ExpenseForm({ expense, onDone }: { expense?: FixedExpense; onDone?: () => void }) {
  const [state, action] = useActionState(async (p: FormState, fd: FormData) => {
    const r = await saveExpenseAction(p, fd);
    if (r.success) onDone?.();
    return r;
  }, {});
  const e = state.fieldErrors ?? {};
  const v = (k: string, f: string) => state.values?.[k] ?? f;
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-border p-3">
      <Alerts state={state} />
      {expense && <input type="hidden" name="id" value={expense.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" name="label" defaultValue={v("label", expense?.label ?? "")} error={e.label} maxLength={80} />
        <SelectField label="Catégorie" name="category" value={v("category", expense?.category ?? "rent")} options={Object.entries(EXPENSE_LABELS)} error={e.category} />
        <Field label="Montant TTC (€)" name="amount" inputMode="decimal" defaultValue={v("amount", centsToInput(expense?.amountCents))} error={e.amount} />
        <SelectField label="Fréquence" name="frequency" value={v("frequency", expense?.frequency ?? "monthly")} options={[["monthly", "Mensuelle"], ["quarterly", "Trimestrielle"], ["yearly", "Annuelle"]]} error={e.frequency} />
        <Field label="Depuis le" name="starts_on" type="date" defaultValue={v("starts_on", expense?.startsOn ?? new Date().toISOString().slice(0, 10))} error={e.starts_on} />
        <Field label="Jusqu'au (facultatif)" name="ends_on" type="date" defaultValue={v("ends_on", expense?.endsOn ?? "")} error={e.ends_on} />
      </div>
      <SubmitButton size="sm" pendingLabel="…" className="self-start">{expense ? "Enregistrer" : "Ajouter la charge"}</SubmitButton>
    </form>
  );
}

export function ExpenseList({ expenses }: { expenses: FixedExpense[] }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const active = expenses.filter((x) => !x.archivedAt);
  const archived = expenses.filter((x) => x.archivedAt);
  return (
    <div className="flex flex-col gap-3">
      {active.length === 0 && <p className="text-sm text-muted-foreground">Aucune charge fixe enregistrée.</p>}
      {active.map((x) =>
        edit === x.id ? (
          <ExpenseForm key={x.id} expense={x} onDone={() => setEdit(null)} />
        ) : (
          <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
            <div>
              <p className="font-semibold">{x.label}</p>
              <p className="text-muted-foreground">{EXPENSE_LABELS[x.category]} · {formatEuros(x.amountCents)} {FREQ_LABELS[x.frequency]} · depuis le {new Date(x.startsOn).toLocaleDateString("fr-FR")}{x.endsOn ? ` jusqu'au ${new Date(x.endsOn).toLocaleDateString("fr-FR")}` : ""}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setEdit(x.id)}>Modifier</button>
              <ActionButton action={archiveExpenseAction} fields={{ id: x.id }} confirm={{ title: "Arrêter cette charge ?", description: "Elle ne sera plus comptée à partir d'aujourd'hui, mais reste dans les périodes passées.", confirmLabel: "Arrêter" }}>Arrêter</ActionButton>
            </div>
          </div>
        ),
      )}
      {adding ? <ExpenseForm onDone={() => setAdding(false)} /> : <button type="button" className="self-start text-sm font-semibold text-primary hover:underline" onClick={() => setAdding(true)}>+ Ajouter une charge fixe</button>}
      {archived.length > 0 && <p className="text-xs text-muted-foreground">{archived.length} charge(s) arrêtée(s), toujours comptée(s) sur leurs périodes passées.</p>}
    </div>
  );
}

// ─── Objectifs ──────────────────────────────────────────────────────
export function GoalsForm({ goals }: { goals: Goals }) {
  const [state, action] = useActionState(saveGoalsAction, {});
  const e = state.fieldErrors ?? {};
  const v = (k: string, f: string) => state.values?.[k] ?? f;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Alerts state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Chiffre d'affaires HT mensuel (€)" name="monthly_revenue" inputMode="decimal" defaultValue={v("monthly_revenue", centsToInput(goals.monthlyRevenueCents))} error={e.monthly_revenue} />
        <Field label="Revenu disponible estimé mensuel (€)" name="monthly_disposable_income" inputMode="decimal" defaultValue={v("monthly_disposable_income", centsToInput(goals.monthlyDisposableIncomeCents))} error={e.monthly_disposable_income} />
        <Field label="Nombre de rendez-vous par mois" name="monthly_appointments" inputMode="numeric" defaultValue={v("monthly_appointments", goals.monthlyAppointments?.toString() ?? "")} error={e.monthly_appointments} />
        <Field label="Marge par heure mobilisée (€)" name="hourly_margin" inputMode="decimal" defaultValue={v("hourly_margin", centsToInput(goals.hourlyMarginCents))} error={e.hourly_margin} />
      </div>
      <p className="text-xs text-muted-foreground">Laissez vide un objectif que vous ne souhaitez pas suivre.</p>
      <SubmitButton pendingLabel="Enregistrement…" className="self-start">Enregistrer mes objectifs</SubmitButton>
    </form>
  );
}

// ─── Règlements d'un rendez-vous ────────────────────────────────────
export function ManualPaymentForm({ appointmentId, remainingCents, idempotencyKey }: { appointmentId: string; remainingCents: number; idempotencyKey: string }) {
  const [state, action] = useActionState(recordManualPaymentAction, {});
  const e = state.fieldErrors ?? {};
  const v = (k: string, f: string) => state.values?.[k] ?? f;
  return (
    <form action={action} className="flex flex-col gap-3">
      <Alerts state={state} />
      <input type="hidden" name="appointment_id" value={appointmentId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Montant (€)" name="amount" inputMode="decimal" defaultValue={v("amount", centsToInput(remainingCents))} error={e.amount} />
        <SelectField label="Moyen" name="method" value={v("method", "card_terminal")} options={[["card_terminal", "Carte (TPE)"], ["cash", "Espèces"], ["transfer", "Virement"], ["check", "Chèque"], ["other", "Autre"]]} error={e.method} />
        <Field label="Reçu le" name="received_on" type="date" defaultValue={v("received_on", new Date().toISOString().slice(0, 10))} error={e.received_on} />
      </div>
      <SelectField label="Type" name="kind" value={v("kind", "balance")} options={[["balance", "Solde de la prestation"], ["deposit", "Arrhes / acompte"], ["other", "Autre"]]} />
      <Field label="Note (facultatif)" name="note" maxLength={500} defaultValue={v("note", "")} />
      <Checkbox name="confirmed" label="Je confirme avoir reçu ce montant" hint="Sans cette case, le règlement reste « à valider » et n'est pas compté comme encaissé." />
      <SubmitButton size="sm" pendingLabel="…" className="self-start">Enregistrer le règlement</SubmitButton>
    </form>
  );
}

export function ValidatePaymentButtons({ paymentId, appointmentId }: { paymentId: string; appointmentId?: string }) {
  const f = { payment_id: paymentId, ...(appointmentId ? { appointment_id: appointmentId } : {}) };
  return (
    <div className="flex gap-2">
      <ActionButton action={validatePaymentAction} fields={{ ...f, decision: "validate" }} variant="default" confirm={{ title: "Valider l'encaissement ?", description: "Confirmez que vous avez bien reçu ce montant. Il ne pourra plus être modifié (une correction passera par une écriture d'ajustement).", confirmLabel: "Valider" }}>Valider</ActionButton>
      <ActionButton action={validatePaymentAction} fields={{ ...f, decision: "cancel" }}>Annuler</ActionButton>
    </div>
  );
}

export function RefundForm({ paymentId, appointmentId, maxCents, online }: { paymentId: string; appointmentId?: string; maxCents: number; online: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(refundAction, {});
  if (!open) return <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setOpen(true)}>Rembourser…</button>;
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="mt-2 flex flex-col gap-3 rounded-xl border border-border p-3">
      <Alerts state={state} />
      <input type="hidden" name="payment_id" value={paymentId} />
      {appointmentId && <input type="hidden" name="appointment_id" value={appointmentId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Montant (max. ${formatEuros(maxCents)})`} name="amount" inputMode="decimal" defaultValue={state.values?.amount ?? centsToInput(maxCents)} error={e.amount} />
        <SelectField label="Motif" name="reason" value={state.values?.reason ?? "cancellation"} options={[["cancellation", "Annulation"], ["customer_request", "Demande de la cliente"], ["duplicate", "Paiement en double"], ["other", "Autre"]]} error={e.reason} />
      </div>
      <Field label="Note (facultatif)" name="note" maxLength={500} />
      <Checkbox name="confirm" label={online ? "Je confirme le remboursement sur la carte de la cliente via Stripe (irréversible)" : "Je confirme avoir remboursé ce montant à la cliente"} />
      {e.confirm && <FieldError>{e.confirm}</FieldError>}
      {online && <p className="text-xs text-muted-foreground">Les frais Stripe du paiement d&apos;origine ne sont pas restitués par Stripe.</p>}
      <div className="flex gap-2">
        <SubmitButton size="sm" pendingLabel="…">Rembourser</SubmitButton>
        <button type="button" className="text-sm text-muted-foreground" onClick={() => setOpen(false)}>Fermer</button>
      </div>
    </form>
  );
}

export function AdjustmentForm({ paymentId }: { paymentId?: string }) {
  const [state, action] = useActionState(addAdjustmentAction, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <Alerts state={state} />
      {paymentId && <input type="hidden" name="payment_id" value={paymentId} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Type" name="kind" value={state.values?.kind ?? "collection"} options={[["collection", "Correction d'encaissement"], ["revenue", "Correction de chiffre d'affaires / avoir"], ["expense", "Dépense directe"], ["fee", "Frais de paiement"]]} error={e.kind} />
        <Field label="Montant (€, négatif pour diminuer)" name="amount" inputMode="decimal" defaultValue={state.values?.amount ?? ""} error={e.amount} />
        <Field label="Date" name="occurred_on" type="date" defaultValue={state.values?.occurred_on ?? new Date().toISOString().slice(0, 10)} error={e.occurred_on} />
      </div>
      <Field label="Motif (obligatoire)" name="reason" maxLength={500} defaultValue={state.values?.reason ?? ""} error={e.reason} />
      <SubmitButton size="sm" pendingLabel="…" className="self-start">Enregistrer l&apos;ajustement</SubmitButton>
    </form>
  );
}

// ─── Stripe ─────────────────────────────────────────────────────────
export function StripeConnectButtons({ connected, ready }: { connected: boolean; ready: boolean }) {
  const [c, connect] = useActionState(connectStripeAction, {});
  const [r, refresh] = useActionState(refreshStripeAction, {});
  const [d, dash] = useActionState(stripeDashboardAction, {});
  return (
    <div className="flex flex-col gap-3">
      <Alerts state={c} />
      <Alerts state={r} />
      <Alerts state={d} />
      <div className="flex flex-wrap gap-2">
        {!ready && (
          <form action={connect}>
            <SubmitButton pendingLabel="Ouverture de Stripe…"><CreditCard /> {connected ? "Terminer l'inscription Stripe" : "Connecter mon compte Stripe"}</SubmitButton>
          </form>
        )}
        {connected && (
          <form action={refresh}>
            <SubmitButton variant="outline" pendingLabel="Vérification…"><RefreshCw /> Actualiser et resynchroniser</SubmitButton>
          </form>
        )}
        {connected && (
          <form action={dash}>
            <SubmitButton variant="outline" pendingLabel="…"><ExternalLink /> Ouvrir mon tableau de bord Stripe</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
