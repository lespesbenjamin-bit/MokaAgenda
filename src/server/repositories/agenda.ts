import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RepositoryError } from "./business";
import type { AppointmentStatus } from "@/lib/domain/appointments";
import type { AvailabilityRule, BlockedPeriod, BusyPeriod } from "@/lib/domain/availability";
import type { Place } from "@/lib/domain/pricing";

/**
 * Accès aux données de l'agenda. Requêtes simples filtrées par business_id ;
 * les règles (horaires, conflits, statuts) sont garanties par PostgreSQL.
 */

export interface Appointment {
  id: string;
  customer_id: string;
  place: Place;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  prep_minutes: number;
  cleanup_minutes: number;
  buffer_minutes: number;
  address_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  price_total_cents: number;
  deposit_amount_cents: number;
  balance_due_cents: number;
  payment_status: string;
  notes_internal: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  source: "manual" | "online";
  customer_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentItem {
  appointment_id: string;
  service_id: string | null;
  position: number;
  service_name: string;
  duration_minutes: number;
  catalog_price_cents: number;
  unit_price_cents: number;
  price_overridden: boolean;
  vat_rate_bps: number;
  deposit_type: string;
  deposit_amount_cents: number;
  consumables_cents: number;
  products_cents: number;
  other_costs_cents: number;
}

export interface BookingEvent {
  event_type: string;
  from_status: AppointmentStatus | null;
  to_status: AppointmentStatus | null;
  old_starts_at: string | null;
  new_starts_at: string | null;
  created_at: string;
}

const APPOINTMENT_COLUMNS =
  "id, customer_id, place, status, starts_at, ends_at, duration_minutes, prep_minutes, cleanup_minutes, buffer_minutes, address_id, address_line1, address_line2, postal_code, city, price_total_cents, deposit_amount_cents, balance_due_cents, payment_status, notes_internal, cancel_reason, cancelled_at, source, customer_comment, created_at, updated_at";
const ITEM_COLUMNS =
  "appointment_id, service_id, position, service_name, duration_minutes, catalog_price_cents, unit_price_cents, price_overridden, vat_rate_bps, deposit_type, deposit_amount_cents, consumables_cents, products_cents, other_costs_cents";

// ─── Horaires et blocages ───────────────────────────────────────────

export async function listRules(supabase: SupabaseClient, businessId: string): Promise<AvailabilityRule[]> {
  const { data, error } = await supabase
    .from("availability_rules")
    .select("weekday, start_minute, end_minute, place")
    .eq("business_id", businessId)
    .order("weekday")
    .order("start_minute");
  if (error) throw new RepositoryError("Lecture des horaires", error);
  return (data ?? []).map((r) => ({ weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute, place: r.place }));
}

export async function replaceRules(supabase: SupabaseClient, businessId: string, rules: AvailabilityRule[]) {
  const { error } = await supabase.rpc("replace_availability_rules", {
    p_business_id: businessId,
    p_rules: rules.map((r) => ({ weekday: r.weekday, start_minute: r.startMinute, end_minute: r.endMinute, place: r.place })),
  });
  if (error) throw new RepositoryError("Enregistrement des horaires", error);
}

export interface AvailabilityException {
  id: string;
  kind: "vacation" | "closure" | "unavailable";
  label: string | null;
  starts_at: string;
  ends_at: string;
  place: Place | null;
}

export async function listExceptions(supabase: SupabaseClient, businessId: string, from: Date, to?: Date) {
  let q = supabase
    .from("availability_exceptions")
    .select("id, kind, label, starts_at, ends_at, place")
    .eq("business_id", businessId)
    .gt("ends_at", from.toISOString())
    .order("starts_at");
  if (to) q = q.lt("starts_at", to.toISOString());
  const { data, error } = await q;
  if (error) throw new RepositoryError("Lecture des blocages", error);
  return (data ?? []) as AvailabilityException[];
}

export async function insertException(
  supabase: SupabaseClient,
  businessId: string,
  values: Omit<AvailabilityException, "id">,
) {
  const { error } = await supabase.from("availability_exceptions").insert({ business_id: businessId, ...values });
  if (error) throw new RepositoryError("Ajout du blocage", error);
}

export async function deleteException(supabase: SupabaseClient, businessId: string, id: string) {
  const { error } = await supabase.from("availability_exceptions").delete().eq("business_id", businessId).eq("id", id);
  if (error) throw new RepositoryError("Suppression du blocage", error);
}

export function toBlocks(exceptions: AvailabilityException[]): BlockedPeriod[] {
  return exceptions.map((e) => ({ start: new Date(e.starts_at), end: new Date(e.ends_at), place: e.place }));
}

// ─── Rendez-vous ────────────────────────────────────────────────────

export async function listAppointments(
  supabase: SupabaseClient,
  businessId: string,
  from: Date,
  to: Date,
  { activeOnly = false } = {},
): Promise<Appointment[]> {
  let q = supabase
    .from("appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("business_id", businessId)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", new Date(from.getTime() - 6 * 3600_000).toISOString()) // marge pour le temps bloqué
    .order("starts_at")
    .limit(2000);
  if (activeOnly) q = q.in("status", ["pending", "confirmed"]);
  const { data, error } = await q;
  if (error) throw new RepositoryError("Lecture des rendez-vous", error);
  return (data ?? []) as Appointment[];
}

/** Périodes occupées (préparation → tampon) des rendez-vous actifs. */
export function toBusy(appointments: Appointment[]): BusyPeriod[] {
  return appointments
    .filter((a) => a.status === "pending" || a.status === "confirmed")
    .map((a) => ({
      id: a.id,
      start: new Date(new Date(a.starts_at).getTime() - a.prep_minutes * 60_000),
      end: new Date(new Date(a.ends_at).getTime() + (a.cleanup_minutes + a.buffer_minutes) * 60_000),
    }));
}

export async function listItems(supabase: SupabaseClient, businessId: string, appointmentIds: string[]): Promise<AppointmentItem[]> {
  if (appointmentIds.length === 0) return [];
  const { data, error } = await supabase
    .from("appointment_items")
    .select(ITEM_COLUMNS)
    .eq("business_id", businessId)
    .in("appointment_id", appointmentIds)
    .order("position");
  if (error) throw new RepositoryError("Lecture des prestations du rendez-vous", error);
  return (data ?? []) as AppointmentItem[];
}

export async function getAppointment(supabase: SupabaseClient, businessId: string, id: string) {
  const { data, error } = await supabase.from("appointments").select(APPOINTMENT_COLUMNS).eq("business_id", businessId).eq("id", id).maybeSingle();
  if (error) throw new RepositoryError("Lecture du rendez-vous", error);
  return data as Appointment | null;
}

export async function listEvents(supabase: SupabaseClient, businessId: string, appointmentId: string): Promise<BookingEvent[]> {
  const { data, error } = await supabase
    .from("booking_events")
    .select("event_type, from_status, to_status, old_starts_at, new_starts_at, created_at")
    .eq("business_id", businessId)
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: false });
  if (error) throw new RepositoryError("Lecture de l'historique", error);
  return (data ?? []) as BookingEvent[];
}

export async function listCustomerNames(supabase: SupabaseClient, businessId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const { data, error } = await supabase.from("customers").select("id, first_name, last_name").eq("business_id", businessId).in("id", ids);
  if (error) throw new RepositoryError("Lecture des clientes", error);
  return new Map((data ?? []).map((c) => [c.id as string, [c.first_name, c.last_name].filter(Boolean).join(" ") || "Sans nom"]));
}

export async function createAppointmentRpc(supabase: SupabaseClient, payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc("create_appointment", { p: payload });
  if (error || !data) throw new RepositoryError("Création du rendez-vous", error ?? undefined);
  return data as string;
}

export async function updateAppointmentRpc(supabase: SupabaseClient, id: string, payload: Record<string, unknown>) {
  const { error } = await supabase.rpc("update_appointment", { p_id: id, p: payload });
  if (error) throw new RepositoryError("Modification du rendez-vous", error);
}

export async function setAppointmentStatus(
  supabase: SupabaseClient,
  businessId: string,
  id: string,
  status: AppointmentStatus,
  cancelReason: string | null,
) {
  const patch: Record<string, unknown> = { status };
  if (status === "cancelled") patch.cancel_reason = cancelReason;
  const { data, error } = await supabase.from("appointments").update(patch).eq("business_id", businessId).eq("id", id).select("id");
  if (error) throw new RepositoryError("Changement de statut", error);
  if (!data?.length) throw new RepositoryError("Changement de statut", { message: "MOKA_NOT_FOUND" });
}

// ─── Indicateurs du tableau de bord ─────────────────────────────────

export async function countAppointments(
  supabase: SupabaseClient,
  businessId: string,
  filter: { from?: Date; to?: Date; statuses?: AppointmentStatus[] },
): Promise<number> {
  let q = supabase.from("appointments").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  if (filter.from) q = q.gte("starts_at", filter.from.toISOString());
  if (filter.to) q = q.lt("starts_at", filter.to.toISOString());
  if (filter.statuses) q = q.in("status", filter.statuses);
  const { count, error } = await q;
  if (error) throw new RepositoryError("Comptage des rendez-vous", error);
  return count ?? 0;
}
