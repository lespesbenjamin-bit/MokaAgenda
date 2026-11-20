"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { buildItemSnapshot, precheckSlot } from "@/server/services/agenda";
import { notifyCustomerOfProChange } from "@/server/services/pro-notifications";
import { checkProTravel, loadProTravel, quoteHomeFee, resolveHomeCoords, saveTravelSnapshot, travelFeeItem } from "@/server/services/pro-travel";
import type { LatLng } from "@/lib/domain/travel";
import {
  createAppointmentRpc,
  deleteException,
  getAppointment,
  insertException,
  listAppointments,
  listCustomerNames,
  listExceptions,
  listItems,
  listRules,
  replaceRules,
  setAppointmentStatus,
  updateAppointmentRpc,
} from "@/server/repositories/agenda";
import { getService } from "@/server/repositories/catalog";
import { getCustomer, insertCustomer, listAddresses } from "@/server/repositories/customers";
import { parseAppointmentForm } from "@/lib/validation/appointments";
import { withValues, type FormState } from "@/lib/validation/auth";
import { translateAppointmentError, type AppointmentStatus } from "@/lib/domain/appointments";
import type { AvailabilityRule } from "@/lib/domain/availability";
import { addDays, hhmmToMinute, isoWeekdayOf, localDate, zonedToUtc } from "@/lib/domain/time";
import type { Place } from "@/lib/domain/pricing";

/**
 * Actions de l'agenda. Toutes passent par le client Supabase de l'utilisatrice
 * (RLS) ; horaires, conflits et statuts sont garantis par PostgreSQL.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppointmentFormState extends FormState {
  suggestions?: string[];
  /** Le trajet n'a pas pu être vérifié : la professionnelle peut enregistrer quand même. */
  travelSkippable?: boolean;
}

const SKIP_HINT = " Vous pouvez cocher « Enregistrer sans vérifier le trajet ».";

function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

async function context() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  return { ctx, supabase, businessId: ctx.business.id, timeZone: ctx.settings?.timezone ?? "Europe/Paris" };
}

type Ctx = Awaited<ReturnType<typeof context>>;

/** Rendez-vous pris en ligne déplacé par la professionnelle : la cliente est prévenue. */
async function notifyIfMoved(c: Ctx, id: string, previousStart: string | null | undefined) {
  if (!previousStart) return;
  const after = await getAppointment(c.supabase, c.businessId, id);
  if (after && after.starts_at !== previousStart && new Date(after.starts_at).getTime() !== new Date(previousStart).getTime()) {
    await notifyCustomerOfProChange(c.supabase, c.ctx, id, "booking_rescheduled_customer", new Date(previousStart));
  }
}

function refresh(id?: string) {
  revalidatePath("/agenda", "layout");
  revalidatePath("/tableau-de-bord");
  if (id) revalidatePath(`/agenda/${id}`);
}

/** Création ou modification depuis le formulaire complet. */
async function saveAppointment(formData: FormData, id: string | null): Promise<AppointmentFormState> {
  const form = formObject(formData);
  const parsed = parseAppointmentForm(form, { requireCustomer: !id });
  if (!parsed.ok) return withValues({ fieldErrors: parsed.errors, error: "Certains champs sont à corriger." }, formData);
  const p = parsed.data;
  const c = await context();
  const { supabase, businessId, timeZone } = c;
  let previousStart: string | null = null;

  let newId: string | null = null;
  let feeQuote: Awaited<ReturnType<typeof quoteHomeFee>> = null;
  try {
    const service = await getService(supabase, businessId, p.serviceId);
    if (!service || service.archived_at) return withValues({ fieldErrors: { service_id: "Prestation introuvable ou archivée." } }, formData);
    const snapshot = buildItemSnapshot(service, p.place, { priceCents: p.priceCents, durationMinutes: p.durationMinutes });
    if (!snapshot) return withValues({ fieldErrors: { place: p.place === "home" ? "Cette prestation n'est pas proposée à domicile." : "Cette prestation n'est pas proposée en institut." } }, formData);

    const startsAt = zonedToUtc(p.date, p.minute, timeZone);
    const check = await precheckSlot(supabase, businessId, timeZone, { startsAt, place: p.place, ...snapshot.timing }, id ?? undefined);
    if (!check.ok) return { ...withValues({ error: check.message }, formData), suggestions: check.suggestions };

    // Déplacements (Sprint 5) : adresse localisée, trajets avec les rendez-vous voisins, frais
    const travel = await loadProTravel(supabase, businessId);
    const skip = form.skip_travel_check === "on";
    let coords: LatLng | null = null;
    const items: Record<string, unknown>[] = [snapshot.item];
    if (travel) {
      if (p.place === "home" && p.address) {
        const r = await resolveHomeCoords(supabase, businessId, { addressId: p.address.addressId, line1: p.address.line1, postalCode: p.address.postalCode, city: p.address.city });
        if (r.ok) coords = r.coords;
        else if (!skip) return { ...withValues({ error: r.message + SKIP_HINT }, formData), travelSkippable: true };
      } else if (p.place === "salon") {
        coords = travel.salon;
      }
      if (coords && !skip) {
        const blockedStart = new Date(startsAt.getTime() - snapshot.timing.prepMinutes * 60_000);
        const blockedEnd = new Date(startsAt.getTime() + (snapshot.timing.durationMinutes + snapshot.timing.cleanupMinutes + snapshot.timing.bufferMinutes) * 60_000);
        const t = await checkProTravel(supabase, businessId, travel, { coords, start: blockedStart, end: blockedEnd, excludeId: id ?? undefined });
        if (!t.ok) return { ...withValues({ error: t.message + (t.unavailable ? SKIP_HINT : "") }, formData), travelSkippable: t.unavailable };
      }
      if (p.place === "home" && coords) {
        try {
          feeQuote = await quoteHomeFee(supabase, businessId, travel, { coords, postcode: p.address?.postalCode ?? null, serviceCents: snapshot.item.unit_price_cents, startsAt, timeZone, serviceRadiusKm: c.ctx.settings?.service_radius_km ?? null });
        } catch {
          feeQuote = null;
        }
        if (feeQuote && feeQuote.fee.feeCents > 0) items.push(travelFeeItem(feeQuote.fee.feeCents, travel.settings.fee_vat_rate_bps));
      }
    }

    const fields = {
      place: p.place,
      starts_at: startsAt.toISOString(),
      duration_minutes: snapshot.timing.durationMinutes,
      prep_minutes: snapshot.timing.prepMinutes,
      cleanup_minutes: snapshot.timing.cleanupMinutes,
      buffer_minutes: snapshot.timing.bufferMinutes,
      address_id: p.address?.addressId ?? "",
      address_line1: p.address?.line1 ?? "",
      address_line2: p.address?.line2 ?? "",
      postal_code: p.address?.postalCode ?? "",
      city: p.address?.city ?? "",
      notes_internal: p.notes ?? "",
      items,
      latitude: coords?.lat ?? "",
      longitude: coords?.lng ?? "",
      skip_travel_check: Boolean(travel) && (skip || !coords),
    };

    if (id) {
      previousStart = (await getAppointment(supabase, businessId, id))?.starts_at ?? null;
      await updateAppointmentRpc(supabase, id, fields);
    } else {
      let customerId: string;
      if (p.customer.mode === "existing") {
        if (!(await getCustomer(supabase, businessId, p.customer.id))) return withValues({ fieldErrors: { customer_id: "Cliente introuvable." } }, formData);
        customerId = p.customer.id;
      } else {
        customerId = await insertCustomer(supabase, businessId, {
          first_name: p.customer.first_name,
          last_name: p.customer.last_name,
          phone: p.customer.phone,
          email: p.customer.email,
          birth_date: null,
          notes: null,
        });
      }
      newId = await createAppointmentRpc(supabase, { ...fields, business_id: businessId, customer_id: customerId, status: p.status });
    }
  } catch (error) {
    console.error("[agenda] enregistrement", error);
    return withValues({ error: translateAppointmentError(error instanceof Error ? error.message : undefined) }, formData);
  }
  const savedId = id ?? newId;
  if (savedId && feeQuote && c.ctx.role) {
    const travel = await loadProTravel(supabase, businessId);
    if (travel) {
      await saveTravelSnapshot(supabase, c.ctx, travel, savedId, {
        distanceM: feeQuote.leg.distanceM,
        durationS: feeQuote.leg.durationS,
        feeCents: feeQuote.fee.feeCents,
        zoneName: feeQuote.area.ok ? feeQuote.area.zoneName : null,
      }).catch((e) => console.error("[déplacements] instantané", e));
    }
  }
  if (id) await notifyIfMoved(c, id, previousStart);
  refresh(id ?? newId ?? undefined);
  redirect(`/agenda/${id ?? newId}?${id ? "modifie" : "cree"}=1`);
}

export async function createAppointmentAction(_prev: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> {
  return saveAppointment(formData, null);
}

export async function updateAppointmentAction(_prev: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Rendez-vous introuvable." };
  return saveAppointment(formData, id);
}

/** Déplacement par glisser-déposer (ou redimensionnement). */
export async function rescheduleAction(id: string, startIso: string, durationMinutes?: number): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(id) || Number.isNaN(Date.parse(startIso))) return { ok: false, error: "Déplacement invalide." };
  if (durationMinutes !== undefined && (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720)) {
    return { ok: false, error: "Durée invalide." };
  }
  const c = await context();
  const { supabase, businessId, timeZone } = c;
  let previousStart: string | null = null;
  try {
    const appt = await getAppointment(supabase, businessId, id);
    if (!appt) return { ok: false, error: "Rendez-vous introuvable." };
    previousStart = appt.starts_at;
    const startsAt = new Date(startIso);
    const check = await precheckSlot(
      supabase,
      businessId,
      timeZone,
      {
        startsAt,
        place: appt.place,
        durationMinutes: durationMinutes ?? appt.duration_minutes,
        prepMinutes: appt.prep_minutes,
        cleanupMinutes: appt.cleanup_minutes,
        bufferMinutes: appt.buffer_minutes,
      },
      id,
    );
    if (!check.ok) return { ok: false, error: check.message };
    const travel = await loadProTravel(supabase, businessId);
    const coords = !travel ? null : appt.place === "salon" ? travel.salon : appt.latitude != null && appt.longitude != null ? { lat: Number(appt.latitude), lng: Number(appt.longitude) } : null;
    if (travel && coords && appt.travel_check !== "skipped_by_pro") {
      const blockedStart = new Date(startsAt.getTime() - appt.prep_minutes * 60_000);
      const blockedEnd = new Date(startsAt.getTime() + ((durationMinutes ?? appt.duration_minutes) + appt.cleanup_minutes + appt.buffer_minutes) * 60_000);
      const t = await checkProTravel(supabase, businessId, travel, { coords, start: blockedStart, end: blockedEnd, excludeId: id });
      if (!t.ok) return { ok: false, error: t.message };
    }
    await updateAppointmentRpc(supabase, id, { starts_at: startsAt.toISOString(), ...(durationMinutes ? { duration_minutes: durationMinutes } : {}) });
  } catch (error) {
    console.error("[agenda] déplacement", error);
    return { ok: false, error: translateAppointmentError(error instanceof Error ? error.message : undefined) };
  }
  await notifyIfMoved(c, id, previousStart);
  refresh(id);
  return { ok: true };
}

export async function changeStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as AppointmentStatus;
  const reason = String(formData.get("cancel_reason") ?? "").trim().slice(0, 500) || null;
  if (!UUID.test(id) || !["confirmed", "completed", "cancelled", "no_show"].includes(status)) return { error: "Action invalide." };
  const c = await context();
  const { supabase, businessId } = c;
  try {
    await setAppointmentStatus(supabase, businessId, id, status, reason);
  } catch (error) {
    console.error("[agenda] statut", error);
    return { error: translateAppointmentError(error instanceof Error ? error.message : undefined) };
  }
  let notice = "";
  if (status === "cancelled") {
    const sent = await notifyCustomerOfProChange(supabase, c.ctx, id, "booking_cancelled_customer");
    if (sent === "sent") notice = " La cliente a été prévenue par email.";
    else if (sent === "simulated") notice = " Email à la cliente simulé (démonstration).";
    else if (sent === "failed") notice = " L'email à la cliente n'a pas pu être envoyé : prévenez-la directement.";
    else if (sent === "skipped") notice = " Emails non configurés : prévenez la cliente directement.";
  }
  refresh(id);
  return { success: `Statut mis à jour.${notice}` };
}

// ─── Données du calendrier ──────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  status: AppointmentStatus;
  place: Place;
  customer: string;
  city: string | null;
}

export interface CalendarBackground {
  start: string;
  end: string;
  kind: "hours-home" | "hours-salon" | "hours-any" | "blocked";
  label?: string;
}

/** Rendez-vous, plages horaires et blocages d'une période affichée. */
export async function fetchCalendarAction(startIso: string, endIso: string): Promise<{ events: CalendarEvent[]; backgrounds: CalendarBackground[]; error?: string }> {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end.getTime() - start.getTime() > 62 * 86_400_000) {
    return { events: [], backgrounds: [], error: "Période invalide." };
  }
  try {
    const { supabase, businessId, timeZone } = await context();
    const [appointments, rules, exceptions] = await Promise.all([
      listAppointments(supabase, businessId, start, end),
      listRules(supabase, businessId),
      listExceptions(supabase, businessId, start, end),
    ]);
    const [items, names] = await Promise.all([
      listItems(supabase, businessId, appointments.map((a) => a.id)),
      listCustomerNames(supabase, businessId, [...new Set(appointments.map((a) => a.customer_id))]),
    ]);
    const serviceOf = new Map<string, string>();
    for (const i of items) if (!serviceOf.has(i.appointment_id)) serviceOf.set(i.appointment_id, i.service_name);

    const events: CalendarEvent[] = appointments
      .filter((a) => new Date(a.starts_at) < end && new Date(a.ends_at) > start)
      .map((a) => ({
        id: a.id,
        title: serviceOf.get(a.id) ?? "Rendez-vous",
        start: a.starts_at,
        end: a.ends_at,
        status: a.status,
        place: a.place,
        customer: names.get(a.customer_id) ?? "Cliente",
        city: a.city,
      }));

    const backgrounds: CalendarBackground[] = [];
    for (let day = localDate(start, timeZone); zonedToUtc(day, 0, timeZone) < end; day = addDays(day, 1)) {
      const weekday = isoWeekdayOf(day);
      for (const r of rules.filter((x) => x.weekday === weekday)) {
        backgrounds.push({
          start: zonedToUtc(day, r.startMinute, timeZone).toISOString(),
          end: zonedToUtc(day, r.endMinute, timeZone).toISOString(),
          kind: r.place === "home" ? "hours-home" : r.place === "salon" ? "hours-salon" : "hours-any",
        });
      }
    }
    for (const e of exceptions) backgrounds.push({ start: e.starts_at, end: e.ends_at, kind: "blocked", label: e.label ?? undefined });
    return { events, backgrounds };
  } catch (error) {
    console.error("[agenda] calendrier", error);
    return { events: [], backgrounds: [], error: "Le chargement de l'agenda a échoué. Réessayez." };
  }
}

/** Adresses d'une cliente, pour le formulaire de rendez-vous à domicile. */
export async function customerAddressesAction(customerId: string) {
  if (!UUID.test(customerId)) return [];
  const { supabase, businessId } = await context();
  const addresses = await listAddresses(supabase, businessId, customerId);
  return addresses.map((a) => ({ id: a.id, label: a.label, kind: a.kind, line1: a.line1, line2: a.line2, postal_code: a.postal_code, city: a.city, is_primary: a.is_primary }));
}

// ─── Horaires et blocages ───────────────────────────────────────────

export async function saveRulesAction(rules: AvailabilityRule[]): Promise<FormState> {
  const clean: AvailabilityRule[] = [];
  for (const r of rules ?? []) {
    const valid =
      Number.isInteger(r.weekday) && r.weekday >= 1 && r.weekday <= 7 &&
      Number.isInteger(r.startMinute) && Number.isInteger(r.endMinute) &&
      r.startMinute >= 0 && r.endMinute <= 1440 && r.endMinute > r.startMinute &&
      (r.place === null || r.place === "home" || r.place === "salon");
    if (!valid) return { error: "Une plage horaire est invalide : vérifiez que l'heure de fin est après l'heure de début." };
    clean.push({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute, place: r.place });
  }
  if (clean.length > 70) return { error: "Trop de plages horaires." };
  const { ctx, supabase, businessId } = await context();
  if (ctx.role !== "business_owner") return { error: "Seule la propriétaire peut modifier les horaires." };
  try {
    await replaceRules(supabase, businessId, clean);
  } catch (error) {
    console.error("[agenda] horaires", error);
    return { error: translateAppointmentError(error instanceof Error ? error.message : undefined) };
  }
  refresh();
  return { success: "Horaires enregistrés." };
}

export async function addExceptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const f = formObject(formData);
  const kind = f.kind as "vacation" | "closure" | "unavailable";
  if (!["vacation", "closure", "unavailable"].includes(kind)) return withValues({ fieldErrors: { kind: "Choisissez un type." } }, formData);
  const place = f.place === "home" || f.place === "salon" ? (f.place as Place) : null;
  const allDay = f.all_day === "on";
  const fromDate = f.from_date ?? "";
  const toDate = f.to_date || fromDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return withValues({ fieldErrors: { from_date: "Dates invalides." } }, formData);
  const fromMin = allDay ? 0 : hhmmToMinute(f.from_time ?? "");
  const toMin = allDay ? 0 : hhmmToMinute(f.to_time ?? "");
  if (fromMin === null || toMin === null) return withValues({ fieldErrors: { from_time: "Heures invalides." } }, formData);

  const { ctx, supabase, businessId, timeZone } = await context();
  if (ctx.role !== "business_owner") return { error: "Seule la propriétaire peut bloquer des périodes." };
  const startsAt = zonedToUtc(fromDate, fromMin, timeZone);
  const endsAt = allDay ? zonedToUtc(addDays(toDate, 1), 0, timeZone) : zonedToUtc(toDate, toMin, timeZone);
  if (endsAt <= startsAt) return withValues({ fieldErrors: { to_date: "La fin doit être après le début." } }, formData);
  if (endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000) return withValues({ fieldErrors: { to_date: "Une période ne peut pas dépasser un an." } }, formData);
  try {
    await insertException(supabase, businessId, {
      kind,
      label: (f.label ?? "").trim().slice(0, 120) || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      place,
    });
    const overlapping = (await listAppointments(supabase, businessId, startsAt, endsAt, { activeOnly: true })).filter(
      (a) => new Date(a.starts_at) < endsAt && new Date(a.ends_at) > startsAt && (place === null || a.place === place),
    );
    refresh();
    return {
      success:
        overlapping.length > 0
          ? `Période bloquée. Attention : ${overlapping.length} rendez-vous déjà prévu${overlapping.length > 1 ? "s" : ""} pendant cette période (non annulé${overlapping.length > 1 ? "s" : ""} automatiquement).`
          : "Période bloquée.",
    };
  } catch (error) {
    console.error("[agenda] blocage", error);
    return withValues({ error: "L'enregistrement a échoué. Réessayez." }, formData);
  }
}

export async function deleteExceptionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Blocage introuvable." };
  const { ctx, supabase, businessId } = await context();
  if (ctx.role !== "business_owner") return { error: "Action réservée à la propriétaire." };
  try {
    await deleteException(supabase, businessId, id);
  } catch (error) {
    console.error("[agenda] suppression blocage", error);
    return { error: "La suppression a échoué." };
  }
  refresh();
  return {};
}

export async function getRulesAction() {
  const { supabase, businessId } = await context();
  return listRules(supabase, businessId);
}
