"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { publicSlotsAction } from "@/server/actions/public-booking";
import type { DaySlots } from "@/server/services/public-booking";
import { addDays } from "@/lib/domain/time";
import { cn } from "@/lib/utils";

const PAGE_DAYS = 14;

/**
 * Choix du créneau : 14 jours à la fois, créneaux recalculés côté serveur
 * à partir du véritable agenda (aucune donnée de rendez-vous n'est envoyée
 * au navigateur, seulement les heures libres).
 */
export function SlotPicker({
  slug,
  serviceId,
  place,
  timeZone,
  today,
  lastDay,
  selected,
  onSelect,
  token,
  refreshKey = 0,
  staticDays,
  geo,
}: {
  slug: string;
  serviceId: string;
  place: "salon" | "home";
  timeZone: string;
  /** Date locale du jour (YYYY-MM-DD) dans le fuseau de l'entreprise. */
  today: string;
  /** Dernier jour réservable. */
  lastDay: string;
  selected: string | null;
  onSelect: (iso: string) => void;
  token?: string;
  refreshKey?: number;
  /** Aperçu local uniquement : créneaux fixes, sans appel serveur. */
  staticDays?: DaySlots[];
  /** Adresse vérifiée (jeton signé par le serveur) pour une prestation à domicile. */
  geo?: unknown;
}) {
  const [fromDay, setFromDay] = useState(today);
  const [days, setDays] = useState<DaySlots[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(
    (from: string) => {
      startTransition(async () => {
        if (staticDays) {
          setDays(staticDays);
          setDay(staticDays.find((d) => d.slots.length)?.day ?? null);
          return;
        }
        const res = await publicSlotsAction({ slug, serviceId, place, fromDay: from, days: PAGE_DAYS, token, geo });
        if (!res.ok) {
          setError(res.message);
          setDays([]);
          return;
        }
        setError(null);
        setDays(res.days);
        setDay((current) => {
          if (current && res.days.some((d) => d.day === current && d.slots.length)) return current;
          return res.days.find((d) => d.slots.length)?.day ?? res.days[0]?.day ?? null;
        });
      });
    },
    [slug, serviceId, place, token, staticDays, geo],
  );

  useEffect(() => {
    load(fromDay);
  }, [load, fromDay, refreshKey]);

  const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric" });
  const monthFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", month: "long", year: "numeric" });
  const longFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone, hour: "2-digit", minute: "2-digit" });
  const asDate = (d: string) => new Date(`${d}T12:00:00Z`);

  const visible = (days ?? []).filter((d) => d.day <= lastDay);
  const current = visible.find((d) => d.day === day);
  const hasAny = visible.some((d) => d.slots.length > 0);
  const canPrev = fromDay > today;
  const pageSize = days?.length || PAGE_DAYS;
  const canNext = addDays(fromDay, pageSize) <= lastDay;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Jours précédents" disabled={!canPrev || pending} onClick={() => setFromDay(addDays(fromDay, -pageSize) < today ? today : addDays(fromDay, -pageSize))}>
          <ChevronLeft />
        </Button>
        <p className="text-sm font-semibold capitalize">{monthFmt.format(asDate(fromDay))}</p>
        <Button type="button" variant="ghost" size="icon" aria-label="Jours suivants" disabled={!canNext || pending} onClick={() => setFromDay(addDays(fromDay, pageSize))}>
          <ChevronRight />
        </Button>
      </div>

      {error && <FormAlert type="error">{error}</FormAlert>}

      {days === null || pending ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Recherche des créneaux disponibles…
        </div>
      ) : (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label="Jour">
            {visible.map((d) => {
              const count = d.slots.length;
              const active = d.day === day;
              return (
                <button
                  key={d.day}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={count === 0}
                  onClick={() => setDay(d.day)}
                  className={cn(
                    "flex min-w-16 shrink-0 flex-col items-center rounded-xl border px-2 py-2 text-xs transition-colors",
                    active ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card hover:bg-secondary",
                    count === 0 && "cursor-not-allowed opacity-40 hover:bg-card",
                  )}
                >
                  <span className="font-semibold capitalize">{dayFmt.format(asDate(d.day))}</span>
                  <span className="mt-0.5 text-[11px] text-muted-foreground">{count ? `${count} créneau${count > 1 ? "x" : ""}` : "Complet"}</span>
                </button>
              );
            })}
          </div>

          {!hasAny && !error && (
            <FormAlert type="info">Aucun créneau disponible sur ces dates.{canNext ? " Essayez les jours suivants." : ""}</FormAlert>
          )}

          {current && current.slots.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold first-letter:uppercase">{longFmt.format(asDate(current.day))}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {current.slots.map((iso) => (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => onSelect(iso)}
                    aria-pressed={selected === iso}
                    className={cn(
                      "h-11 rounded-xl border text-sm font-semibold transition-colors",
                      selected === iso ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary hover:bg-accent",
                    )}
                  >
                    {timeFmt.format(new Date(iso))}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
