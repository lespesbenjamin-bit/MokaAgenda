import Link from "next/link";
import { AlertTriangle, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { FormAlert } from "@/components/ui/form-alert";
import { BreakdownBars, FinanceTabs, Kpi, Line, Panel, PeriodFilter, hours, pct } from "@/components/finance/finance-ui";
import { RevenueChart } from "@/components/finance/revenue-chart";
import { formatEuros } from "@/lib/domain/pricing";
import type { FinanceSummary, SeriesPoint } from "@/lib/domain/finance";


const EXPORTS = [
  ["prestations", "Prestations réalisées"],
  ["encaissements", "Encaissements"],
  ["remboursements", "Remboursements"],
  ["charges", "Charges fixes"],
  ["deplacements", "Frais de déplacement"],
  ["synthese", "Synthèse mensuelle"],
] as const;

export function FinanceDashboardView({ sel, label, summary: s, series }: { sel: { key: string; from: string; to: string }; label: string; summary: FinanceSummary; series: SeriesPoint[] }) {
  const q = new URLSearchParams({ periode: sel.key, ...(sel.key === "custom" ? { du: sel.from, au: sel.to } : {}) }).toString();
  const r = s.revenue;
  const c = s.collections;
  const k = s.costs;
  const res = s.results;

  return (
    <div>
      <PageHeader title="Finances" description="Chiffre d'affaires, encaissements, charges et marges. Montants en euros ; HT = hors taxes." />
      <FinanceTabs active="/finances" />
      <PeriodFilter base="/finances" active={sel.key} from={sel.from} to={sel.to} label={label} />

      {s.warnings.length > 0 && (
        <div className="mb-6 flex flex-col gap-1 rounded-2xl border border-warning/40 bg-warning-soft p-4 text-sm">
          {s.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> {w}</p>
          ))}
          {s.warnings.some((w) => w.includes("TVA") || w.includes("cotisations")) && (
            <Link href="/parametres/finances" className="mt-1 font-semibold text-primary hover:underline">Compléter mes paramètres financiers</Link>
          )}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="CA réalisé (HT)" value={formatEuros(r.realized.ht)} nature="réalisé" hint={`${r.realizedCount} rendez-vous terminé(s)`} strong />
        <Kpi label="CA prévisionnel (HT)" value={formatEuros(r.forecast.ht)} nature="prévisionnel" hint={`${r.forecastCount} rendez-vous à venir`} />
        <Kpi label="Encaissé net" value={formatEuros(c.net)} nature="encaissé" hint="Paiements reçus − remboursements" />
        <Kpi label="Revenu disponible" value={formatEuros(res.disposableIncome)} nature="estimé" hint="Après charges, cotisations et provision" />
      </div>

      <div className="mb-6">
        <Panel title="Évolution du chiffre d'affaires HT" description={`${label} · réalisé et prévisionnel`}>
          <div className="pt-2"><RevenueChart points={series} /></div>
        </Panel>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="Chiffre d'affaires" description={label}>
          <Line label="CA réalisé HT" cents={r.realized.ht} nature="réalisé" strong />
          <Line label="dont prestations" cents={r.realizedServices.ht} sub />
          <Line label="dont frais de déplacement facturés" cents={r.realizedTravelFees.ht} sub />
          {r.retainedDeposits > 0 && <Line label="dont arrhes / acomptes conservés (annulations)" cents={r.retainedDeposits} sub />}
          {r.revenueAdjustments !== 0 && <Line label="dont ajustements / avoirs" cents={r.revenueAdjustments} sub />}
          <Line label="TVA collectée" cents={r.realized.vat} hint="à reverser, jamais un revenu" />
          <Line label="CA réalisé TTC" cents={r.realized.ttc} />
          <Line label="CA domicile (HT)" cents={r.home.ht} />
          <Line label="CA institut (HT)" cents={r.salon.ht} />
          <Line label="CA prévisionnel HT" cents={r.forecast.ht} nature="prévisionnel" />
          {r.toCloseCount > 0 && <Line label={`Passés à clôturer (${r.toCloseCount})`} cents={r.toClose.ht} hint="non comptés" />}
          <div className="py-2 text-sm text-muted-foreground">
            Annulations : {r.cancelledCount} ({formatEuros(r.cancelledTtc)} TTC non réalisés) · absences : {r.noShowCount}
          </div>
        </Panel>

        <Panel title="Encaissements" description={`${label} · date de réception`}>
          <Line label="Total encaissé" cents={c.total} nature="encaissé" strong />
          <Line label="Arrhes / acomptes" cents={c.deposits} sub />
          <Line label="Soldes" cents={c.balances} sub />
          {c.others > 0 && <Line label="Autres" cents={c.others} sub />}
          <Line label="dont paiements en ligne (Stripe)" cents={c.online} sub />
          <Line label="Remboursements" cents={c.refunds} negative />
          {c.adjustments !== 0 && <Line label="Ajustements d'encaissement" cents={c.adjustments} />}
          <Line label="Encaissé net" cents={c.net} strong />
          <Line label="Frais Stripe" cents={c.stripeFees} negative />
          <Line label="Versé par Stripe sur votre compte bancaire" cents={c.payouts} hint="virements arrivés" />
          <Line label="Reste à encaisser" cents={c.outstanding} hint="rendez-vous de la période" />
          {c.pendingValidationCount > 0 && <Line label={`Règlements à valider (${c.pendingValidationCount})`} cents={c.pendingValidation} hint="non comptés" />}
          <p className="py-2 text-xs text-muted-foreground">Un paiement réussi n&apos;est pas encore un virement reçu : Stripe verse les fonds sur votre compte bancaire selon son calendrier.</p>
        </Panel>

        <Panel title="Charges" description={`${label} · rendez-vous terminés`}>
          <Line label="Dépenses décaissées" cents={k.cashTotal} nature="décaissé" strong />
          <Line label="Consommables" cents={k.consumables} sub />
          <Line label="Produits utilisés" cents={k.products} sub />
          <Line label="Autres coûts directs" cents={k.otherDirect} sub />
          <Line label="Carburant / énergie des trajets" cents={k.travelEnergy} sub />
          <Line label="Péages, stationnement, frais par trajet" cents={k.travelOther} sub />
          <Line label="Frais de paiement" cents={k.paymentFees} sub />
          {k.expenseAdjustments !== 0 && <Line label="Dépenses saisies en ajustement" cents={k.expenseAdjustments} sub />}
          <Line label="Usure du véhicule" cents={k.vehicleWearEstimated} nature="estimé" />
          <Line label="Valorisation du temps de trajet" cents={k.timeValuationEstimated} nature="estimé" hint="indicatif, hors marge" />
          <Line label="Charges fixes (proratisées)" cents={k.fixed} strong />
          {k.fixedLines.map((l) => <Line key={l.label} label={l.label} cents={l.cents} sub />)}
          <p className="py-2 text-xs text-muted-foreground">Proratisation : montant annuel × jours de la période / 365.</p>
        </Panel>

        <Panel title="Résultats" description={`${label} · estimations de gestion`}>
          <Line label="Marge contributive" cents={res.contributionMargin} nature="estimé" strong hint={`taux ${pct(res.marginRate)}`} />
          <Line label="Charges fixes" cents={k.fixed} negative />
          <Line label="Résultat d'exploitation estimé" cents={res.operatingResult} strong />
          <Line label="Cotisations estimées" cents={res.contributions} negative />
          <Line label="Provision fiscale indicative" cents={res.taxProvision} negative />
          <Line label="Revenu disponible estimé" cents={res.disposableIncome} nature="estimé" strong />
          <div className="py-2 text-sm">
            Temps mobilisé : <strong>{hours(res.mobilizedMinutes)}</strong> · marge par heure : <strong>{res.hourlyMargin === null ? "—" : formatEuros(res.hourlyMargin)}</strong> · CA HT par heure : <strong>{res.hourlyRevenue === null ? "—" : formatEuros(res.hourlyRevenue)}</strong>
          </div>
          <p className="py-2 text-xs text-muted-foreground">
            Estimation calculée avec vos paramètres : ce n&apos;est ni votre solde bancaire, ni une donnée comptable certifiée.
          </p>
        </Panel>

        <Panel title="Répartition par catégorie (HT)" description={`${label} · réalisé`}>
          <BreakdownBars rows={r.byCategory} total={r.realized.ht - r.retainedDeposits - r.revenueAdjustments} />
        </Panel>
        <Panel title="Répartition par prestation (HT)" description={`${label} · réalisé`}>
          <BreakdownBars rows={r.byService} total={r.realizedServices.ht} />
        </Panel>
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Exports CSV</h2>
        <p className="mb-3 text-xs text-muted-foreground">Période : {label}. Fichiers séparés par « ; », lisibles dans Excel, Numbers ou Google Sheets.</p>
        <div className="flex flex-wrap gap-2">
          {EXPORTS.map(([kind, l]) => (
            <a key={kind} href={`/api/finances/export?type=${kind}&${q}`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:border-primary">
              <Download className="size-4" /> {l}
            </a>
          ))}
        </div>
      </section>
      <FormAlert type="info">Les chiffres reposent sur les montants figés de chaque rendez-vous (prix, TVA, coûts) et sur le registre des paiements.</FormAlert>
    </div>
  );
}
