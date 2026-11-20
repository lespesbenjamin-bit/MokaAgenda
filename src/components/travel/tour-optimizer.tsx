"use client";

import { useState, useTransition } from "react";
import { Loader2, Route, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { applyTourAction, proposeTourAction } from "@/server/actions/tours";
import type { TourProposal } from "@/server/services/tours";
import { formatEuros } from "@/lib/domain/pricing";

const km = (m: number) => `${(m / 1000).toFixed(1).replace(".", ",")} km`;
const mn = (s: number) => `${Math.round(s / 60)} min`;

/** « Optimiser ma tournée » : propose, compare, et n'applique qu'après validation explicite. */
export function TourOptimizer({ day, timeZone, names }: { day: string; timeZone: string; names: Record<string, string> }) {
  const [p, setP] = useState<(TourProposal & { error?: string }) | null>(null);
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const t = new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setConsent(false);
            setP(await proposeTourAction(day));
          })
        }
      >
        {pending && !p ? <Loader2 className="animate-spin" /> : <Sparkles />} Optimiser ma tournée
      </Button>
      {p?.error && <FormAlert type="error">{p.error}</FormAlert>}
      {p?.message && <FormAlert type="info">{p.message}</FormAlert>}
      {p?.current && p.proposed && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-4 text-sm">
          <p className="font-bold">Proposition (rien n&apos;est encore modifié)</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Kpi label="Kilomètres" before={km(p.current.distanceM)} after={km(p.proposed.distanceM)} gain={km(p.current.distanceM - p.proposed.distanceM)} />
            <Kpi label="Temps de route" before={mn(p.current.durationS)} after={mn(p.proposed.durationS)} gain={mn(p.current.durationS - p.proposed.durationS)} />
            <Kpi label="Coût estimé" before={p.current.costCents != null ? formatEuros(p.current.costCents) : "—"} after={p.proposed.costCents != null ? formatEuros(p.proposed.costCents) : "—"} gain={p.current.costCents != null && p.proposed.costCents != null ? formatEuros(p.current.costCents - p.proposed.costCents) : "—"} />
          </div>
          <p className="text-xs text-muted-foreground">Économies <strong>estimées</strong>, calculées sur les trajets routiers sans trafic : elles ne seront réelles que si la tournée est appliquée et réalisée ainsi.</p>
          <ol className="flex flex-col gap-1">
            {p.proposed.order.map((id, i) => (
              <li key={id} className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>
                <span className="flex-1">{names[id] ?? "Cliente"}</span>
                <span className="font-semibold">{t.format(new Date(p.proposed!.starts[id]))}</span>
              </li>
            ))}
          </ol>
          {p.moved.length > 0 && (
            <div className="rounded-xl bg-warning-soft p-3 text-warning">
              <p className="font-semibold">Horaires modifiés pour {p.moved.length} cliente{p.moved.length > 1 ? "s" : ""} :</p>
              <ul className="mt-1 list-disc pl-5">
                {p.moved.map((m) => (
                  <li key={m.id}>
                    {m.customer} : {t.format(new Date(m.from))} → {t.format(new Date(m.to))}
                    {m.online ? " (recevra un email)" : " (à prévenir vous-même)"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 accent-[var(--primary)]" />
            J&apos;ai l&apos;accord des clientes concernées pour ces nouveaux horaires.
          </label>
          <Button
            type="button"
            disabled={!consent || pending || !p.planId}
            onClick={() =>
              start(async () => {
                const r = await applyTourAction(p.planId!, consent);
                setResult(r);
                if (r.ok) setP(null);
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Route />} Appliquer cette tournée
          </Button>
        </div>
      )}
      {result?.error && <FormAlert type="error">{result.error}</FormAlert>}
      {result?.message && <FormAlert type="success">{result.message}</FormAlert>}
    </div>
  );
}

function Kpi({ label, before, after, gain }: { label: string; before: string; after: string; gain: string }) {
  return (
    <div className="rounded-xl bg-secondary p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xs line-through opacity-60">{before}</p>
      <p className="font-bold">{after}</p>
      <p className="text-xs text-success">− {gain}</p>
    </div>
  );
}
