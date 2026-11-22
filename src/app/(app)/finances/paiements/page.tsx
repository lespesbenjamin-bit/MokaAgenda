import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { FinanceTabs, PeriodFilter } from "@/components/finance/finance-ui";
import { AdjustmentForm, RefundForm, ValidatePaymentButtons } from "@/components/finance/finance-forms";
import { KIND_LABELS, METHOD_LABELS, PAYMENT_STATUS, REFUND_REASON, REFUND_STATUS } from "@/components/finance/payment-labels";
import { formatEuros } from "@/lib/domain/pricing";
import { cn } from "@/lib/utils";
import { periodLabel, readPeriod, requireFinanceOwner } from "@/server/services/finance";
import { getPaymentAccount, listAdjustments, listDisputes, listPaymentEvents, listPaymentHistory, listPendingPayments, type PaymentHistoryRow } from "@/server/repositories/finance";

export const metadata: Metadata = { title: "Paiements" };
export const dynamic = "force-dynamic";

const ADJ: Record<string, string> = { revenue: "CA / avoir", collection: "Encaissement", expense: "Dépense", fee: "Frais de paiement" };

function PaymentRow({ p, tz }: { p: PaymentHistoryRow; tz: string }) {
  const refunded = p.refunds.filter((r) => ["requested", "pending", "succeeded"].includes(r.status)).reduce((s, r) => s + r.amount_cents, 0);
  const who = p.appointments?.customers ? `${p.appointments.customers.first_name} ${p.appointments.customers.last_name ?? ""}`.trim() : "—";
  const what = (p.appointments?.appointment_items ?? []).filter((i) => i.kind === "service").map((i) => i.service_name).join(" + ");
  const st = PAYMENT_STATUS[p.status];
  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {formatEuros(p.amount_cents)} · {KIND_LABELS[p.kind]} <span className={cn("ml-1 rounded-full px-2 py-0.5 text-xs font-semibold", st.tone)}>{st.label}</span>
          </p>
          <p className="text-muted-foreground">
            {new Intl.DateTimeFormat("fr-FR", { timeZone: tz, dateStyle: "medium" }).format(new Date(p.received_at))} · {METHOD_LABELS[p.method]} · {who}
            {what ? ` · ${what}` : ""}
            {p.fee_cents != null ? ` · frais Stripe ${formatEuros(p.fee_cents)}` : p.method === "card_online" ? " · frais Stripe en attente" : ""}
          </p>
          {p.stripe_payment_intent_id && <p className="text-xs text-muted-foreground">Transaction {p.stripe_payment_intent_id}</p>}
          {p.note && <p className="text-xs text-muted-foreground">Note : {p.note}</p>}
          {p.refunds.map((r) => (
            <p key={r.id} className="text-xs">↳ Remboursement {formatEuros(r.amount_cents)} — {REFUND_STATUS[r.status]} ({REFUND_REASON[r.reason]}){r.failure_reason ? ` : ${r.failure_reason}` : ""}</p>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {p.appointment_id && <Link href={`/agenda/${p.appointment_id}`} className="text-sm font-medium text-primary hover:underline">Rendez-vous</Link>}
          {p.status === "pending" && <ValidatePaymentButtons paymentId={p.id} appointmentId={p.appointment_id ?? undefined} />}
        </div>
      </div>
      {p.status === "succeeded" && p.amount_cents - refunded > 0 && <RefundForm paymentId={p.id} appointmentId={p.appointment_id ?? undefined} maxCents={p.amount_cents - refunded} online={p.method === "card_online"} />}
    </li>
  );
}

export default async function PaymentsPage({ searchParams }: PageProps<"/finances/paiements">) {
  const { ctx, supabase, zone } = await requireFinanceOwner();
  const sel = readPeriod(await searchParams, zone);
  const [history, pending, disputes, events, adjustments, account] = await Promise.all([
    listPaymentHistory(supabase, ctx.business.id, sel.period),
    listPendingPayments(supabase, ctx.business.id),
    listDisputes(supabase, ctx.business.id),
    listPaymentEvents(supabase, ctx.business.id),
    listAdjustments(supabase, ctx.business.id, 20),
    getPaymentAccount(supabase, ctx.business.id),
  ]);
  return (
    <div>
      <PageHeader title="Finances" description="Historique des paiements, remboursements, contestations et corrections." />
      <FinanceTabs active="/finances/paiements" />
      {!account?.charges_enabled && (
        <p className="mb-4 rounded-2xl border border-border bg-card p-4 text-sm">
          Paiement en ligne des arrhes : {account ? "compte Stripe à finaliser" : "non activé"}. <Link href="/parametres/paiements" className="font-semibold text-primary hover:underline">Configurer Stripe</Link>
        </p>
      )}
      {pending.length > 0 && (
        <section className="mb-6 rounded-2xl border border-warning/40 bg-card p-5">
          <h2 className="font-semibold">Règlements à valider ({pending.length})</h2>
          <p className="text-xs text-muted-foreground">Non comptés comme encaissés tant que vous ne les avez pas validés.</p>
          <ul className="divide-y divide-border">{pending.map((p) => <PaymentRow key={p.id} p={p} tz={zone} />)}</ul>
        </section>
      )}
      <PeriodFilter base="/finances/paiements" active={sel.key} from={sel.from} to={sel.to} label={periodLabel(sel.period, zone)} />
      <section className="mb-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Paiements reçus</h2>
        {history.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Aucun paiement sur la période.</p> : <ul className="divide-y divide-border">{history.map((p) => <PaymentRow key={p.id} p={p} tz={zone} />)}</ul>}
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Contestations de paiement</h2>
          {disputes.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Aucune contestation.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {disputes.map((d) => (
                <li key={d.id} className="py-2">{formatEuros(d.amount_cents)} · {d.status} · {d.reason}{d.evidence_due_by ? ` · justificatifs avant le ${new Date(d.evidence_due_by).toLocaleDateString("fr-FR")}` : ""}</li>
              ))}
            </ul>
          )}
          <p className="pt-2 text-xs text-muted-foreground">Les réponses aux contestations se font depuis votre tableau de bord Stripe.</p>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-semibold">Écriture d&apos;ajustement</h2>
          <p className="mb-3 text-xs text-muted-foreground">Un paiement passé n&apos;est jamais modifié : toute correction est une écriture datée et motivée, conservée dans l&apos;historique.</p>
          <AdjustmentForm />
          {adjustments.length > 0 && (
            <ul className="mt-4 divide-y divide-border border-t border-border text-sm">
              {adjustments.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 py-2"><span>{new Date(a.occurred_on).toLocaleDateString("fr-FR")} · {ADJ[a.kind]} · {a.reason}</span><span className="shrink-0 tabular-nums">{formatEuros(a.amount_cents)}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {events.length > 0 && (
        <details className="mt-6 rounded-2xl border border-border bg-card p-5 text-sm">
          <summary className="cursor-pointer font-semibold">Journal technique Stripe ({events.length} derniers événements)</summary>
          <ul className="mt-2 divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-1.5 text-xs"><span>{new Date(e.received_at).toLocaleString("fr-FR")} · {e.type}</span><span className="text-muted-foreground">{e.status}{e.outcome ? ` · ${e.outcome}` : ""}{e.attempts > 1 ? ` · ${e.attempts} essais` : ""}{e.last_error ? ` · ${e.last_error}` : ""}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
