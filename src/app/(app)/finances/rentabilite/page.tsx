import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { FinanceTabs, PeriodFilter } from "@/components/finance/finance-ui";
import { formatDuration, formatEuros } from "@/lib/domain/pricing";
import { MIN_OBSERVATIONS, type ServiceProfit } from "@/lib/domain/finance";
import { loadProfitability } from "@/server/services/finance";

export const metadata: Metadata = { title: "Rentabilité" };
export const dynamic = "force-dynamic";

function Ranking({ title, items, value }: { title: string; items: ServiceProfit[]; value: (s: ServiceProfit) => string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Pas encore assez de données.</p>
      ) : (
        <ol className="flex flex-col gap-1 text-sm">
          {items.map((s, i) => (
            <li key={s.key} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {s.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{value(s)}</span></li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default async function ProfitabilityPage({ searchParams }: PageProps<"/finances/rentabilite">) {
  const { sel, label, list, rankings } = await loadProfitability(await searchParams);
  const perHour = (s: ServiceProfit) => (s.marginPerHour === null ? "—" : `${formatEuros(s.marginPerHour)} / h`);
  return (
    <div>
      <PageHeader title="Finances" description="Rentabilité réelle de chaque prestation, à partir des rendez-vous terminés." />
      <FinanceTabs active="/finances/rentabilite" />
      <PeriodFilter base="/finances/rentabilite" active={sel.key} from={sel.from} to={sel.to} label={label} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Ranking title="Les plus rentables (marge / heure)" items={rankings.mostProfitable} value={perHour} />
        <Ranking title="Les moins rentables (marge / heure)" items={rankings.leastProfitable} value={perHour} />
        <Ranking title="Les plus demandées" items={rankings.mostRequested} value={(s) => `${s.count} fois`} />
        <Ranking title="Les plus longues" items={rankings.mostTimeConsuming} value={(s) => formatDuration(s.avgMinutes)} />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Classements établis seulement pour les prestations réalisées au moins {MIN_OBSERVATIONS} fois sur la période. Marge contributive estimée = CA HT (frais de déplacement facturés inclus) − consommables, produits et coûts directs − coût des trajets (énergie, péages, usure estimée) − frais de paiement. Les coûts d&apos;un rendez-vous à plusieurs prestations sont répartis au prorata du prix HT ; le temps, au prorata des durées.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              {["Prestation", "Réalisées", "Prix moyen TTC", "CA HT", "Consommables moy.", "Trajet moy.", "Frais paiement moy.", "Marge contributive", "Temps moyen", "Marge / heure"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Aucune prestation terminée sur la période.</td></tr>
            )}
            {list.map((s) => (
              <tr key={s.key}>
                <td className="px-3 py-2 font-medium">{s.name}{!s.enoughData && <span className="ml-2 text-xs font-normal text-muted-foreground">(moins de {MIN_OBSERVATIONS})</span>}</td>
                <td className="px-3 py-2 tabular-nums">{s.count}</td>
                <td className="px-3 py-2 tabular-nums">{formatEuros(s.avgPriceTtc)}</td>
                <td className="px-3 py-2 tabular-nums">{formatEuros(s.revenueHt)}</td>
                <td className="px-3 py-2 tabular-nums">{formatEuros(s.avgConsumables)}</td>
                <td className="px-3 py-2 tabular-nums">{formatEuros(s.avgTravelCost)}</td>
                <td className="px-3 py-2 tabular-nums">{formatEuros(s.avgPaymentFees)}</td>
                <td className="px-3 py-2 font-semibold tabular-nums">{formatEuros(s.margin)}</td>
                <td className="px-3 py-2 tabular-nums">{formatDuration(s.avgMinutes)}</td>
                <td className="px-3 py-2 tabular-nums">{perHour(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
