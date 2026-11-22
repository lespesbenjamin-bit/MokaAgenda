import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/domain/pricing";

/** Pièces d'affichage des finances : chaque chiffre porte son unité, sa période et sa nature. */

export type Nature = "réalisé" | "prévisionnel" | "estimé" | "encaissé" | "décaissé";

const NATURE_TONE: Record<Nature, string> = {
  réalisé: "bg-success-soft text-success",
  encaissé: "bg-success-soft text-success",
  prévisionnel: "bg-accent text-accent-foreground",
  estimé: "bg-warning-soft text-warning",
  décaissé: "bg-secondary text-muted-foreground",
};

export function NatureTag({ nature }: { nature: Nature }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", NATURE_TONE[nature])}>{nature}</span>;
}

export function Kpi({ label, value, nature, hint, strong }: { label: string; value: string; nature: Nature; hint?: string; strong?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-4", strong && "border-primary/40")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <NatureTag nature={nature} />
      </div>
      <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Line({ label, cents, nature, sub, negative, strong, hint }: { label: string; cents: number; nature?: Nature; sub?: boolean; negative?: boolean; strong?: boolean; hint?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-2 text-sm", sub && "pl-4 text-muted-foreground", strong && "font-semibold")}>
      <span className="flex flex-wrap items-center gap-2">
        {label}
        {nature && <NatureTag nature={nature} />}
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 tabular-nums">{negative && cents !== 0 ? `− ${formatEuros(cents)}` : formatEuros(cents)}</span>
    </div>
  );
}

export function Panel({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

const TABS = [
  { href: "/finances", label: "Tableau de bord" },
  { href: "/finances/rentabilite", label: "Rentabilité" },
  { href: "/finances/paiements", label: "Paiements" },
  { href: "/finances/objectifs", label: "Objectifs" },
];

export function FinanceTabs({ active }: { active: string }) {
  return (
    <nav className="-mt-4 mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Sections des finances">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={cn("shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold", active === t.href ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

const PERIODS = [
  { key: "today", label: "Aujourd'hui" },
  { key: "week", label: "Cette semaine" },
  { key: "month", label: "Ce mois" },
  { key: "quarter", label: "Ce trimestre" },
  { key: "year", label: "Cette année" },
] as const;

/** Filtres de période (liens, sans JavaScript) + période personnalisée. */
export function PeriodFilter({ base, active, from, to, label }: { base: string; active: string; from: string; to: string; label: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`${base}?periode=${p.key}`}
            aria-current={active === p.key ? "true" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", active === p.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary")}
          >
            {p.label}
          </Link>
        ))}
        <form action={base} className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="periode" value="custom" />
          <label className="sr-only" htmlFor="du">Du</label>
          <input id="du" name="du" type="date" defaultValue={from} required className="h-9 rounded-lg border border-input bg-card px-2" />
          <label className="sr-only" htmlFor="au">Au</label>
          <input id="au" name="au" type="date" defaultValue={to} required className="h-9 rounded-lg border border-input bg-card px-2" />
          <button className={cn("h-9 rounded-full border px-3 font-medium", active === "custom" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary")}>Période personnalisée</button>
        </form>
      </div>
      <p className="text-sm text-muted-foreground">
        Période : <strong className="text-foreground">{label}</strong>
      </p>
    </div>
  );
}

/** Barres horizontales (répartition) : une seule couleur, valeur en texte. */
export function BreakdownBars({ rows, total }: { rows: { name: string; ht: number; count: number }[]; total: number }) {
  if (rows.length === 0) return <p className="py-2 text-sm text-muted-foreground">Aucune prestation terminée sur la période.</p>;
  const max = Math.max(...rows.map((r) => r.ht), 1);
  return (
    <ul className="flex flex-col gap-3 py-2">
      {rows.slice(0, 8).map((r) => (
        <li key={r.name} className="flex flex-col gap-1 text-sm" title={`${r.name} : ${formatEuros(r.ht)} HT, ${r.count} rendez-vous`}>
          <div className="flex justify-between gap-3">
            <span className="truncate">{r.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatEuros(r.ht)} · {total > 0 ? Math.round((r.ht / total) * 100) : 0} %
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary">
            <div className="h-2 rounded-full bg-[#CC4A0C]" style={{ width: `${Math.max(2, (r.ht / max) * 100)}%` }} />
          </div>
        </li>
      ))}
      {rows.length > 8 && <li className="text-xs text-muted-foreground">+ {rows.length - 8} autre(s)</li>}
    </ul>
  );
}

export const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1).replace(".", ",")} %`);
export const hours = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
