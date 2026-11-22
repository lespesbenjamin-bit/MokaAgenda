import type { Metadata } from "next";
import { FinanceDashboardView } from "@/components/finance/dashboard-view";
import { loadDashboard } from "@/server/services/finance";

export const metadata: Metadata = { title: "Finances" };
export const dynamic = "force-dynamic";

export default async function FinancesPage({ searchParams }: PageProps<"/finances">) {
  const { sel, label, summary, series } = await loadDashboard(await searchParams);
  return <FinanceDashboardView sel={sel} label={label} summary={summary} series={series} />;
}
