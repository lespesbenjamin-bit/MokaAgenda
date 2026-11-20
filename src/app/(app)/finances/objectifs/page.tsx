import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { FinanceTabs, NatureTag } from "@/components/finance/finance-ui";
import { GoalsForm } from "@/components/finance/finance-forms";
import { formatEuros } from "@/lib/domain/pricing";
import { MIN_OBSERVATIONS, type GoalLine } from "@/lib/domain/finance";
import { loadGoals } from "@/server/services/finance";

export const metadata: Metadata = { title: "Objectifs" };
export const dynamic = "force-dynamic";

const LABELS: Record<GoalLine["key"], string> = { revenue: "Chiffre d'affaires HT", disposable: "Revenu disponible estimé", appointments: "Rendez-vous", hourly: "Marge par heure mobilisée" };
const fmt = (l: GoalLine, v: number) => (l.key === "appointments" ? String(v) : formatEuros(v));

export default async function GoalsPage() {
  const { goals, lines, sim, monthLabel } = await loadGoals();
  return (
    <div>
      <PageHeader title="Finances" description="Vos objectifs du mois et le chemin restant." />
      <FinanceTabs active="/finances/objectifs" />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Mois en cours : <strong className="text-foreground">{monthLabel}</strong></p>
          {lines.length === 0 && <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">Aucun objectif défini : renseignez-les dans le formulaire.</p>}
          {lines.map((l) => (
            <div key={l.key} className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-semibold">{LABELS[l.key]}</h2>
                <span className="text-sm text-muted-foreground">objectif {fmt(l, l.target)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.round(l.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${LABELS[l.key]} : ${Math.round(l.progress * 100)} %`}>
                <div className="h-2.5 rounded-full bg-[#CC4A0C]" style={{ width: `${Math.max(1, l.progress * 100)}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="flex items-center gap-1 text-xs text-muted-foreground">Réalisé <NatureTag nature={l.key === "disposable" || l.key === "hourly" ? "estimé" : "réalisé"} /></dt><dd className="font-semibold tabular-nums">{fmt(l, l.realized)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Avec le prévisionnel</dt><dd className="font-semibold tabular-nums">{fmt(l, l.projected)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Écart</dt><dd className={l.gap >= 0 ? "font-semibold tabular-nums text-success" : "font-semibold tabular-nums"}>{l.gap >= 0 ? "+" : "−"} {fmt(l, Math.abs(l.gap))}</dd></div>
              </dl>
              <p className="mt-1 text-xs text-muted-foreground">Progression : {Math.round(l.progress * 100)} % (réalisé).</p>
            </div>
          ))}
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-semibold">Combien de prestations supplémentaires pour mon objectif de CA ?</h2>
            {sim.reason === "no_goal" && <p className="mt-1 text-sm text-muted-foreground">Définissez un objectif de chiffre d&apos;affaires pour lancer la simulation.</p>}
            {sim.reason === "reached" && <p className="mt-1 text-sm text-success">Objectif atteint avec le réalisé et les rendez-vous à venir.</p>}
            {sim.reason === "not_enough_data" && <p className="mt-1 text-sm text-muted-foreground">Pas assez de données : il faut au moins {MIN_OBSERVATIONS} rendez-vous terminés sur les 90 derniers jours (actuellement {sim.observations}).</p>}
            {sim.ok && (
              <>
                <p className="mt-2 font-display text-3xl font-bold">{sim.additionalAppointments} rendez-vous</p>
                <p className="text-sm text-muted-foreground">supplémentaires ce mois-ci pour combler {formatEuros(sim.remainingCents!)} HT.</p>
                <p className="mt-2 text-xs text-muted-foreground">Hypothèse : chaque rendez-vous rapporte le CA HT moyen de vos {sim.observations} rendez-vous terminés des 90 derniers jours, soit {formatEuros(sim.avgRevenueHt!)}. Simulation indicative, sans garantie de résultat.</p>
              </>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 font-semibold">Mes objectifs mensuels</h2>
          <GoalsForm goals={goals} />
        </div>
      </div>
    </div>
  );
}
