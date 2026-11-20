/**
 * Moteur de disponibilités — MÊMES règles que le déclencheur PostgreSQL
 * `private.appointment_check_availability` et la contrainte d'exclusion :
 *  • le temps bloqué (préparation → prestation → nettoyage + tampon) doit
 *    tenir entièrement dans UNE plage horaire compatible avec le lieu ;
 *  • il ne doit toucher aucun blocage (congé, fermeture, indisponibilité) ;
 *  • il ne doit chevaucher aucun rendez-vous actif.
 * La base reste la garantie finale ; ce module sert à expliquer les refus,
 * à proposer des créneaux libres (agenda, et réservation en ligne au Sprint 4).
 */
import { addDays, isoWeekdayOf, localDate, localMinute, zonedParts, zonedToUtc } from "./time";
import type { Place } from "./pricing";

export interface AvailabilityRule {
  weekday: number; // 1 = lundi … 7 = dimanche
  startMinute: number;
  endMinute: number;
  place: Place | null; // null = domicile et institut
}

export interface BlockedPeriod {
  start: Date;
  end: Date;
  place: Place | null;
}

export interface BusyPeriod {
  id?: string;
  start: Date;
  end: Date;
}

export interface SlotRequest {
  startsAt: Date;
  durationMinutes: number;
  prepMinutes: number;
  cleanupMinutes: number;
  bufferMinutes: number;
  place: Place;
}

export interface AvailabilityContext {
  timeZone: string;
  rules: AvailabilityRule[];
  blocks: BlockedPeriod[];
  busy: BusyPeriod[];
  /** Rendez-vous à ignorer (celui qu'on déplace). */
  ignoreId?: string;
}

export type SlotRefusal = "outside_hours" | "blocked" | "conflict";

export const REFUSAL_MESSAGES: Record<SlotRefusal, string> = {
  outside_hours: "Ce créneau est en dehors de vos horaires pour ce lieu, pendant une pause, ou la prestation dépasse la fin de la plage.",
  blocked: "Ce créneau tombe pendant un congé, une fermeture ou une indisponibilité.",
  conflict: "Ce créneau chevauche un autre rendez-vous (préparation et temps tampon compris).",
};

const MINUTE = 60_000;

export function occupiedRange(r: SlotRequest): { start: Date; end: Date } {
  const start = new Date(r.startsAt.getTime() - r.prepMinutes * MINUTE);
  const end = new Date(r.startsAt.getTime() + (r.durationMinutes + r.cleanupMinutes + r.bufferMinutes) * MINUTE);
  return { start, end };
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/** Le temps bloqué tient-il dans une plage horaire du bon jour et du bon lieu ? */
export function fitsWorkingHours(start: Date, end: Date, place: Place, ctx: Pick<AvailabilityContext, "timeZone" | "rules">): boolean {
  const startDay = localDate(start, ctx.timeZone);
  const endDay = localDate(end, ctx.timeZone);
  const endParts = zonedParts(end, ctx.timeZone);
  const endsAtMidnightNextDay = endDay === addDays(startDay, 1) && endParts.hour === 0 && endParts.minute === 0 && endParts.second === 0;
  if (endDay !== startDay && !endsAtMidnightNextDay) return false;

  const weekday = zonedParts(start, ctx.timeZone).isoWeekday;
  const startMin = localMinute(start, ctx.timeZone);
  let endMin = endsAtMidnightNextDay ? 1440 : localMinute(end, ctx.timeZone);
  if (!endsAtMidnightNextDay && endParts.second > 0) endMin += 1;

  return ctx.rules.some((r) => r.weekday === weekday && r.startMinute <= startMin && r.endMinute >= endMin && (r.place === null || r.place === place));
}

export function checkSlot(req: SlotRequest, ctx: AvailabilityContext): { ok: true } | { ok: false; reason: SlotRefusal } {
  const { start, end } = occupiedRange(req);
  if (!fitsWorkingHours(start, end, req.place, ctx)) return { ok: false, reason: "outside_hours" };
  if (ctx.blocks.some((b) => (b.place === null || b.place === req.place) && overlaps(start, end, b.start, b.end))) return { ok: false, reason: "blocked" };
  // Les périodes sans identifiant (réservation publique) ne sont jamais ignorées.
  if (ctx.busy.some((b) => (ctx.ignoreId === undefined || b.id !== ctx.ignoreId) && overlaps(start, end, b.start, b.end))) return { ok: false, reason: "conflict" };
  return { ok: true };
}

/**
 * Créneaux de début possibles pour une journée locale ("YYYY-MM-DD").
 * Pas de 15 minutes par défaut ; ignore les créneaux avant `notBefore`
 * (délai minimum de réservation).
 */
export function freeSlots(
  day: string,
  req: Omit<SlotRequest, "startsAt">,
  ctx: AvailabilityContext,
  { stepMinutes = 15, notBefore }: { stepMinutes?: number; notBefore?: Date } = {},
): Date[] {
  const weekday = isoWeekdayOf(day);
  const out = new Map<number, Date>();
  for (const rule of ctx.rules) {
    if (rule.weekday !== weekday || (rule.place !== null && rule.place !== req.place)) continue;
    const first = rule.startMinute + req.prepMinutes;
    const last = rule.endMinute - (req.durationMinutes + req.cleanupMinutes + req.bufferMinutes);
    // Aligne le premier créneau sur la grille du pas
    for (let m = Math.ceil(first / stepMinutes) * stepMinutes; m <= last; m += stepMinutes) {
      const startsAt = zonedToUtc(day, m, ctx.timeZone);
      if (localMinute(startsAt, ctx.timeZone) !== m) continue; // heure inexistante (passage à l'heure d'été)
      if (notBefore && startsAt < notBefore) continue;
      if (checkSlot({ ...req, startsAt }, ctx).ok) out.set(startsAt.getTime(), startsAt);
    }
  }
  return [...out.values()].sort((a, b) => a.getTime() - b.getTime());
}
