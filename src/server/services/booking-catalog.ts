import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getService, listServices, toPricing, toTimes, type Service } from "@/server/repositories/catalog";
import { listAddresses, searchCustomers, type CustomerAddress } from "@/server/repositories/customers";
import { buildPriceSnapshot, isPlaceOffered, type AppointmentPriceSnapshot, type Place } from "@/lib/domain/pricing";

/**
 * Point d'entrée prévu pour l'agenda (Sprint 3) : choix d'une prestation,
 * d'une cliente, calcul de la durée, du prix et de l'acompte, gestion du lieu.
 * Aucune interface d'agenda n'est développée à ce stade.
 */

/** Prestations réservables : actives, non archivées, proposées au lieu demandé. */
export async function listBookableServices(supabase: SupabaseClient, businessId: string, place?: Place): Promise<Service[]> {
  const services = await listServices(supabase, businessId);
  return services.filter((s) => s.is_active && !s.archived_at && (!place || isPlaceOffered(toPricing(s), place)));
}

/**
 * Devis figé pour un futur rendez-vous : durée, temps mobilisé, prix TTC/HT,
 * acompte et solde. Ce résultat sera enregistré tel quel dans le rendez-vous
 * (instantané), afin qu'un changement de tarif ultérieur ne modifie pas l'historique.
 */
export async function quoteService(
  supabase: SupabaseClient,
  businessId: string,
  serviceId: string,
  place: Place,
): Promise<AppointmentPriceSnapshot | null> {
  const s = await getService(supabase, businessId, serviceId);
  if (!s || s.archived_at || !s.is_active) return null;
  const pricing = toPricing(s);
  if (!isPlaceOffered(pricing, place)) return null;
  return buildPriceSnapshot({ id: s.id, name: s.name, ...toTimes(s) }, pricing, s.costs, place);
}

/** Recherche de cliente (nom, email, téléphone) pour la prise de rendez-vous. */
export const findCustomersForBooking = searchCustomers;

/** Adresse d'intervention par défaut pour un rendez-vous à domicile. */
export async function defaultHomeAddress(supabase: SupabaseClient, businessId: string, customerId: string): Promise<CustomerAddress | null> {
  const addresses = await listAddresses(supabase, businessId, customerId);
  return addresses.find((a) => a.is_primary) ?? addresses[0] ?? null;
}
