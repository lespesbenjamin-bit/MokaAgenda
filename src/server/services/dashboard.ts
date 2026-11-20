import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countAppointments, listAppointments, listCustomerNames, listItems, listRules } from "@/server/repositories/agenda";
import { addDays, isoWeekdayOf, localDate, zonedToUtc } from "@/lib/domain/time";

/**
 * Indicateurs RÉELS de l'agenda (aucun chiffre d'affaires ni bénéfice :
 * l'analyse financière arrive au Sprint 6).
 */
export async function loadAgendaKpis(supabase: SupabaseClient, businessId: string, timeZone: string, now = new Date()) {
  const today = localDate(now, timeZone);
  const dayStart = zonedToUtc(today, 0, timeZone);
  const dayEnd = zonedToUtc(addDays(today, 1), 0, timeZone);
  const monday = addDays(today, 1 - isoWeekdayOf(today));
  const weekStart = zonedToUtc(monday, 0, timeZone);
  const weekEnd = zonedToUtc(addDays(monday, 7), 0, timeZone);
  const monthStart = zonedToUtc(`${today.slice(0, 8)}01`, 0, timeZone);
  const [y, m] = today.split("-").map(Number);
  const nextMonth = zonedToUtc(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, 0, timeZone);
  const active = ["pending", "confirmed"] as const;

  const [rules, todayCount, upcoming, week, completed, cancelled] = await Promise.all([
    listRules(supabase, businessId),
    countAppointments(supabase, businessId, { from: dayStart, to: dayEnd, statuses: [...active, "completed"] }),
    countAppointments(supabase, businessId, { from: now, statuses: [...active] }),
    countAppointments(supabase, businessId, { from: weekStart, to: weekEnd, statuses: [...active, "completed", "no_show"] }),
    countAppointments(supabase, businessId, { from: monthStart, to: nextMonth, statuses: ["completed"] }),
    countAppointments(supabase, businessId, { from: monthStart, to: nextMonth, statuses: ["cancelled"] }),
  ]);

  const next = (await listAppointments(supabase, businessId, now, addDaysDate(now, 30), { activeOnly: true }))
    .filter((a) => new Date(a.starts_at) >= now)
    .slice(0, 5);
  const [items, names] = await Promise.all([
    listItems(supabase, businessId, next.map((a) => a.id)),
    listCustomerNames(supabase, businessId, [...new Set(next.map((a) => a.customer_id))]),
  ]);
  return {
    hasRules: rules.length > 0,
    kpis: { today: todayCount, upcoming, week, completed, cancelled },
    next: next.map((a) => ({
      id: a.id,
      startsAt: a.starts_at,
      place: a.place,
      status: a.status,
      customer: names.get(a.customer_id) ?? "Cliente",
      service: items.find((i) => i.appointment_id === a.id)?.service_name ?? "Rendez-vous",
      city: a.city,
    })),
  };
}

function addDaysDate(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}
