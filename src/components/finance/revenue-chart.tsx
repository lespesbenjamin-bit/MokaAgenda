"use client";

import { useState } from "react";
import { formatEuros } from "@/lib/domain/pricing";
import type { SeriesPoint } from "@/lib/domain/finance";

/**
 * Évolution du CA HT : réalisé (orange) et prévisionnel (bleu), barres côte à côte.
 * Palette validée (scripts/validate_palette.js : #CC4A0C, #1F72A8 — tous les contrôles OK).
 * Infobulle au survol / au toucher ; légende ; vue tableau accessible.
 */
const REALIZED = "#CC4A0C";
const FORECAST = "#1F72A8";

export function RevenueChart({ points }: { points: SeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...points.map((p) => Math.max(p.realizedHt, p.forecastHt)));
  const empty = points.every((p) => p.realizedHt === 0 && p.forecastHt === 0);
  const W = 640;
  const H = 180;
  const pad = 4;
  const slot = (W - pad * 2) / Math.max(points.length, 1);
  const bar = Math.max(2, Math.min(14, slot / 2 - 2));
  const y = (v: number) => H - (v / max) * (H - 10);
  const ticks = [0, 0.5, 1].map((r) => Math.round(max * r));
  const labelEvery = Math.ceil(points.length / 8);
  const active = hover !== null ? points[hover] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-4" aria-hidden>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: REALIZED }} /> Réalisé (HT)</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: FORECAST }} /> Prévisionnel (HT)</span>
        </div>
        <button type="button" onClick={() => setTable((t) => !t)} className="font-medium text-primary underline-offset-2 hover:underline">
          {table ? "Voir le graphique" : "Voir le tableau"}
        </button>
      </div>
      {empty && !table ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Aucun rendez-vous terminé ou à venir sur cette période.</p>
      ) : table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">Période</th><th className="py-1 text-right">Réalisé HT</th><th className="py-1 text-right">Prévisionnel HT</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {points.map((p) => (
                <tr key={p.key}><td className="py-1">{p.label}</td><td className="py-1 text-right tabular-nums">{formatEuros(p.realizedHt)}</td><td className="py-1 text-right tabular-nums">{formatEuros(p.forecastHt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img" aria-label="Évolution du chiffre d'affaires HT réalisé et prévisionnel" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad} x2={W - pad} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeWidth={1} />
              </g>
            ))}
            {points.map((p, i) => {
              const cx = pad + slot * i + slot / 2;
              return (
                <g key={p.key}>
                  {hover === i && <rect x={cx - slot / 2} y={0} width={slot} height={H} className="fill-secondary" />}
                  {p.realizedHt > 0 && <rect x={cx - bar - 1} y={y(p.realizedHt)} width={bar} height={H - y(p.realizedHt)} rx={Math.min(4, bar / 2)} fill={REALIZED} />}
                  {p.forecastHt > 0 && <rect x={cx + 1} y={y(p.forecastHt)} width={bar} height={H - y(p.forecastHt)} rx={Math.min(4, bar / 2)} fill={FORECAST} />}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">{p.label}</text>
                  )}
                  <rect x={cx - slot / 2} y={0} width={slot} height={H + 22} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          <p className="pointer-events-none absolute left-1 top-0 text-[11px] text-muted-foreground">max {formatEuros(max)}</p>
          {active && (
            <div className="pointer-events-none absolute right-1 top-0 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
              <p className="font-semibold">{active.label}</p>
              <p>Réalisé : {formatEuros(active.realizedHt)} HT</p>
              <p>Prévisionnel : {formatEuros(active.forecastHt)} HT</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
