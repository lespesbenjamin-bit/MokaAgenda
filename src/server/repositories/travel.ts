import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RepositoryError } from "./business";
import type { FeeSettings, ServiceArea, Vehicle } from "@/lib/domain/travel";

/** Accès aux réglages de déplacement (RLS : lecture membres, écriture propriétaire). */

export interface TravelSettings extends FeeSettings {
  business_id: string;
  enabled: boolean;
  start_point: "travel_base" | "salon";
  return_point: "none" | "travel_base" | "salon";
  safety_margin_pct: number;
  safety_margin_minutes: number;
  fee_vat_rate_bps: number;
  version: number;
}

const SETTINGS_COLUMNS =
  "business_id, enabled, start_point, return_point, safety_margin_pct, safety_margin_minutes, pricing_mode, fixed_fee_cents, per_km_cents, included_km, min_fee_cents, max_fee_cents, free_above_cents, fee_vat_rate_bps, version";

export async function getTravelSettings(supabase: SupabaseClient, businessId: string): Promise<TravelSettings | null> {
  const { data, error } = await supabase.from("travel_settings").select(SETTINGS_COLUMNS).eq("business_id", businessId).maybeSingle();
  if (error) throw new RepositoryError("Lecture des réglages de déplacement", error);
  if (!data) return null;
  return { ...(data as TravelSettings), included_km: Number((data as TravelSettings).included_km) };
}

export async function updateTravelSettings(supabase: SupabaseClient, businessId: string, patch: Partial<Omit<TravelSettings, "business_id" | "version">>) {
  const { data, error } = await supabase.from("travel_settings").update(patch).eq("business_id", businessId).select("business_id");
  if (error) throw new RepositoryError("Réglages de déplacement", error);
  if (!data?.length) throw new RepositoryError("Réglages de déplacement", { message: "non autorisé" });
}

export interface VehicleRow extends Vehicle {
  id: string;
  is_default: boolean;
  archived_at: string | null;
}

const VEHICLE_COLUMNS =
  "id, label, kind, consumption_per_100km, energy_unit, energy_price_millis, wear_cost_per_km_millis, all_in_cost_per_km_millis, fixed_cost_per_trip_cents, parking_tolls_per_trip_cents, hourly_time_cost_cents, is_default, archived_at";

const toVehicle = (v: VehicleRow): VehicleRow => ({ ...v, consumption_per_100km: v.consumption_per_100km == null ? null : Number(v.consumption_per_100km) });

export async function listVehicles(supabase: SupabaseClient, businessId: string): Promise<VehicleRow[]> {
  const { data, error } = await supabase.from("vehicles").select(VEHICLE_COLUMNS).eq("business_id", businessId).is("archived_at", null).order("created_at");
  if (error) throw new RepositoryError("Lecture des véhicules", error);
  return ((data ?? []) as VehicleRow[]).map(toVehicle);
}

export async function defaultVehicle(supabase: SupabaseClient, businessId: string): Promise<VehicleRow | null> {
  const list = await listVehicles(supabase, businessId);
  return list.find((v) => v.is_default) ?? null;
}

export async function saveVehicle(supabase: SupabaseClient, businessId: string, id: string | null, v: Vehicle & { is_default: boolean }) {
  if (v.is_default) {
    const { error } = await supabase.from("vehicles").update({ is_default: false }).eq("business_id", businessId).eq("is_default", true).neq("id", id ?? "00000000-0000-0000-0000-000000000000");
    if (error) throw new RepositoryError("Véhicule par défaut", error);
  }
  if (id) {
    const { data, error } = await supabase.from("vehicles").update(v).eq("business_id", businessId).eq("id", id).select("id");
    if (error) throw new RepositoryError("Modification du véhicule", error);
    if (!data?.length) throw new RepositoryError("Modification du véhicule", { message: "non autorisée" });
    return id;
  }
  const { data, error } = await supabase.from("vehicles").insert({ ...v, business_id: businessId }).select("id").single();
  if (error) throw new RepositoryError("Création du véhicule", error);
  return (data as { id: string }).id;
}

export async function archiveVehicle(supabase: SupabaseClient, businessId: string, id: string) {
  const { error } = await supabase.from("vehicles").update({ archived_at: new Date().toISOString(), is_default: false }).eq("business_id", businessId).eq("id", id);
  if (error) throw new RepositoryError("Archivage du véhicule", error);
}

const AREA_COLUMNS = "id, name, kind, max_km, postcodes, excluded, surcharge_cents, min_order_cents, weekdays, position, is_active";

export async function listAreas(supabase: SupabaseClient, businessId: string): Promise<(ServiceArea & { is_active: boolean })[]> {
  const { data, error } = await supabase.from("service_areas").select(AREA_COLUMNS).eq("business_id", businessId).order("position").order("created_at");
  if (error) throw new RepositoryError("Lecture des zones", error);
  return ((data ?? []) as (ServiceArea & { is_active: boolean })[]).map((z) => ({ ...z, max_km: z.max_km == null ? null : Number(z.max_km) }));
}

export async function saveArea(supabase: SupabaseClient, businessId: string, id: string | null, z: Omit<ServiceArea, "id"> & { is_active: boolean }) {
  if (id) {
    const { data, error } = await supabase.from("service_areas").update(z).eq("business_id", businessId).eq("id", id).select("id");
    if (error) throw new RepositoryError("Modification de la zone", error);
    if (!data?.length) throw new RepositoryError("Modification de la zone", { message: "non autorisée" });
    return;
  }
  const { error } = await supabase.from("service_areas").insert({ ...z, business_id: businessId });
  if (error) throw new RepositoryError("Création de la zone", error);
}

export async function deleteArea(supabase: SupabaseClient, businessId: string, id: string) {
  const { error } = await supabase.from("service_areas").delete().eq("business_id", businessId).eq("id", id);
  if (error) throw new RepositoryError("Suppression de la zone", error);
}

export interface GeoLocation {
  kind: "salon" | "travel_base";
  address_line1: string;
  postal_code: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  geocode_label: string | null;
}

export async function listGeoLocations(supabase: SupabaseClient, businessId: string): Promise<GeoLocation[]> {
  const { data, error } = await supabase.from("locations").select("kind, address_line1, postal_code, city, latitude, longitude, geocoded_at, geocode_label").eq("business_id", businessId);
  if (error) throw new RepositoryError("Lecture des adresses", error);
  return ((data ?? []) as GeoLocation[]).map((l) => ({ ...l, latitude: l.latitude == null ? null : Number(l.latitude), longitude: l.longitude == null ? null : Number(l.longitude) }));
}

export async function setLocationCoords(supabase: SupabaseClient, businessId: string, kind: "salon" | "travel_base", c: { lat: number; lng: number; label: string }) {
  const { data, error } = await supabase
    .from("locations")
    .update({ latitude: c.lat, longitude: c.lng, geocoded_at: new Date().toISOString(), geocode_label: c.label.slice(0, 300) })
    .eq("business_id", businessId)
    .eq("kind", kind)
    .select("kind");
  if (error) throw new RepositoryError("Localisation de l'adresse", error);
  if (!data?.length) throw new RepositoryError("Localisation de l'adresse", { message: "non autorisée" });
}

export async function setCustomerAddressCoords(supabase: SupabaseClient, businessId: string, addressId: string, c: { lat: number; lng: number }) {
  const { error } = await supabase
    .from("customer_addresses")
    .update({ latitude: c.lat, longitude: c.lng, geocoded_at: new Date().toISOString(), geocode_source: "ign" })
    .eq("business_id", businessId)
    .eq("id", addressId);
  if (error) throw new RepositoryError("Localisation de l'adresse cliente", error);
}

export async function getCustomerAddressCoords(supabase: SupabaseClient, businessId: string, addressId: string) {
  const { data, error } = await supabase.from("customer_addresses").select("latitude, longitude").eq("business_id", businessId).eq("id", addressId).maybeSingle();
  if (error) throw new RepositoryError("Adresse cliente", error);
  const d = data as { latitude: number | null; longitude: number | null } | null;
  return d && d.latitude != null && d.longitude != null ? { lat: Number(d.latitude), lng: Number(d.longitude) } : null;
}

export interface EstimateRow {
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  distance_m: number;
  duration_s: number;
  geometry: [number, number][] | null;
}

export async function listEstimates(supabase: SupabaseClient, businessId: string): Promise<EstimateRow[]> {
  const { data, error } = await supabase
    .from("travel_estimates")
    .select("from_lat, from_lng, to_lat, to_lng, distance_m, duration_s, geometry")
    .eq("business_id", businessId)
    .gt("expires_at", new Date().toISOString())
    .limit(5000);
  if (error) throw new RepositoryError("Lecture des trajets", error);
  return ((data ?? []) as EstimateRow[]).map((e) => ({ ...e, from_lat: Number(e.from_lat), from_lng: Number(e.from_lng), to_lat: Number(e.to_lat), to_lng: Number(e.to_lng) }));
}

export interface AppointmentTravelRow {
  appointment_id: string;
  distance_meters: number | null;
  duration_minutes: number | null;
  fee_cents: number | null;
  origin: string | null;
  zone_name: string | null;
  energy_cost_cents: number | null;
  wear_cost_cents: number | null;
  time_cost_cents: number | null;
  other_cost_cents: number | null;
  economic_cost_cents: number | null;
  settings_version: number | null;
  vehicle_snapshot: { label?: string; all_in_cost_per_km_millis?: number | null } | null;
  computed_at: string | null;
}

export async function getAppointmentTravel(supabase: SupabaseClient, businessId: string, appointmentId: string): Promise<AppointmentTravelRow | null> {
  const { data, error } = await supabase.from("appointment_travel").select("*").eq("business_id", businessId).eq("appointment_id", appointmentId).maybeSingle();
  if (error) throw new RepositoryError("Lecture du trajet", error);
  return data as AppointmentTravelRow | null;
}

export async function upsertAppointmentTravel(supabase: SupabaseClient, businessId: string, row: Omit<AppointmentTravelRow, "vehicle_snapshot"> & { vehicle_id: string | null; vehicle_snapshot: unknown; source: string; fee_vat_rate_bps: number }) {
  const existing = await getAppointmentTravel(supabase, businessId, row.appointment_id);
  const { appointment_id, ...rest } = row;
  const q = existing
    ? supabase.from("appointment_travel").update(rest).eq("business_id", businessId).eq("appointment_id", appointment_id)
    : supabase.from("appointment_travel").insert({ ...row, business_id: businessId });
  const { error } = await q;
  if (error) throw new RepositoryError("Enregistrement du trajet du rendez-vous", error);
}
