import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkSlot, freeSlots, REFUSAL_MESSAGES, type AvailabilityContext, type SlotRequest } from "@/lib/domain/availability";
import { depositAmountCents, excludingVatCents, isPlaceOffered, totalPriceCents, type Place } from "@/lib/domain/pricing";
import { addDays, localDate, minuteToHHMM, localMinute, zonedToUtc } from "@/lib/domain/time";
import { listAppointments, listExceptions, listRules, toBlocks, toBusy } from "@/server/repositories/agenda";
import { toPricing, type Service } from "@/server/repositories/catalog";

/**
 * Logique métier de l'agenda : instantané de la prestation et pré-contrôle
 * de disponibilité (messages clairs + créneaux proposés). PostgreSQL refait
 * tous les contrôles à l'enregistrement.
 */

export interface AppointmentTiming {
  durationMinutes: number;
  prepMinutes: number;
  cleanupMinutes: number;
  bufferMinutes: number;
}

/** Instantané de la prestation (prix, TVA, acompte, coûts) avec éventuelles modifications manuelles. */
export function buildItemSnapshot(service: Service, place: Place, overrides: { priceCents: number | null; durationMinutes: number | null }) {
  const pricing = toPricing(service);
  if (!isPlaceOffered(pricing, place)) return null;
  const catalogPrice = totalPriceCents(pricing, place);
  const unit = overrides.priceCents ?? catalogPrice;
  const duration = overrides.durationMinutes ?? service.duration_minutes;
  return {
    timing: {
      durationMinutes: duration,
      prepMinutes: service.prep_minutes,
      cleanupMinutes: service.cleanup_minutes,
      bufferMinutes: service.buffer_minutes,
    } satisfies AppointmentTiming,
    item: {
      service_id: service.id,
      service_name: service.name,
      duration_minutes: duration,
      catalog_price_cents: catalogPrice,
      unit_price_cents: unit,
      extra_fee_cents: 0,
      vat_rate_bps: service.vat_rate_bps,
      price_ht_cents: excludingVatCents(unit, service.vat_rate_bps),
      deposit_type: service.deposit_type,
      deposit_amount_cents: depositAmountCents(pricing, unit),
      consumables_cents: service.costs.consumablesCents,
      products_cents: service.costs.productsCents,
      other_costs_cents: service.costs.otherCents,
    },
  };
}

/** Contexte de disponibilité autour d'une journée locale. */
export async function loadAvailabilityContext(
  supabase: SupabaseClient,
  businessId: string,
  timeZone: string,
  day: string,
  ignoreId?: string,
): Promise<AvailabilityContext> {
  const from = zonedToUtc(addDays(day, -1), 0, timeZone);
  const to = zonedToUtc(addDays(day, 2), 0, timeZone);
  const [rules, exceptions, appointments] = await Promise.all([
    listRules(supabase, businessId),
    listExceptions(supabase, businessId, from, to),
    listAppointments(supabase, businessId, from, to, { activeOnly: true }),
  ]);
  return { timeZone, rules, blocks: toBlocks(exceptions), busy: toBusy(appointments), ignoreId };
}

/** Pré-contrôle : renvoie un message clair et des créneaux libres le même jour si refus. */
export async function precheckSlot(
  supabase: SupabaseClient,
  businessId: string,
  timeZone: string,
  request: SlotRequest,
  ignoreId?: string,
): Promise<{ ok: true } | { ok: false; message: string; suggestions: string[] }> {
  const day = localDate(request.startsAt, timeZone);
  const ctx = await loadAvailabilityContext(supabase, businessId, timeZone, day, ignoreId);
  if (ctx.rules.length === 0) {
    return { ok: false, message: "Vos horaires ne sont pas encore configurés. Renseignez-les dans « Horaires » avant de prendre des rendez-vous.", suggestions: [] };
  }
  const result = checkSlot(request, ctx);
  if (result.ok) return result;
  const { startsAt: _ignored, ...rest } = request;
  void _ignored;
  const suggestions = freeSlots(day, rest, ctx, { stepMinutes: 15 })
    .slice(0, 8)
    .map((d) => minuteToHHMM(localMinute(d, timeZone)));
  return { ok: false, message: REFUSAL_MESSAGES[result.reason], suggestions };
}
