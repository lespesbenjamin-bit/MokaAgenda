"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { proposeTour, type TourProposal } from "@/server/services/tours";
import { notifyCustomerOfProChange } from "@/server/services/pro-notifications";
import { translateAppointmentError } from "@/lib/domain/appointments";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function proposeTourAction(day: string): Promise<TourProposal & { error?: string }> {
  if (!DAY.test(day)) return { planId: null, message: null, current: null, proposed: null, moved: [], error: "Date invalide." };
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  try {
    return await proposeTour(supabase, ctx, day);
  } catch (e) {
    console.error("[tournées] optimisation", e);
    return { planId: null, message: null, current: null, proposed: null, moved: [], error: "L'optimisation a échoué. Réessayez dans un instant." };
  }
}

/**
 * Applique une tournée proposée : uniquement après validation explicite de la
 * professionnelle, qui confirme avoir l'accord des clientes concernées.
 * Tout ou rien, trajets revérifiés par la base ; les clientes ayant réservé
 * en ligne reçoivent un email de modification.
 */
export async function applyTourAction(planId: string, consent: boolean): Promise<{ ok: boolean; error?: string; message?: string }> {
  if (!UUID.test(planId)) return { ok: false, error: "Proposition introuvable." };
  if (!consent) return { ok: false, error: "Confirmez que les clientes concernées sont d'accord avant d'appliquer." };
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const { data: stops } = await supabase.from("route_plan_stops").select("appointment_id, current_starts_at, proposed_starts_at").eq("route_plan_id", planId);
  const { error } = await supabase.rpc("apply_route_plan", { p_plan_id: planId });
  if (error) return { ok: false, error: translateAppointmentError(error.message) };
  let notified = 0;
  for (const s of (stops ?? []) as { appointment_id: string; current_starts_at: string; proposed_starts_at: string }[]) {
    if (new Date(s.current_starts_at).getTime() === new Date(s.proposed_starts_at).getTime()) continue;
    const r = await notifyCustomerOfProChange(supabase, ctx, s.appointment_id, "booking_rescheduled_customer", new Date(s.current_starts_at));
    if (r === "sent" || r === "simulated") notified++;
  }
  revalidatePath("/tournees");
  revalidatePath("/agenda", "layout");
  return { ok: true, message: `Tournée appliquée.${notified ? ` ${notified} cliente${notified > 1 ? "s" : ""} prévenue${notified > 1 ? "s" : ""} par email.` : ""}` };
}
