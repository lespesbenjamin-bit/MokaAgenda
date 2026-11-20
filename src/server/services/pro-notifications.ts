import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSiteUrl } from "@/lib/env";
import { bookingPath } from "@/lib/domain/slug";
import { getAppointment, listItems } from "@/server/repositories/agenda";
import { getCustomer } from "@/server/repositories/customers";
import { sendEmail } from "@/server/notifications/mailer";
import { renderEmail, type NotificationKind } from "@/server/notifications/templates";
import type { BusinessContext } from "./business-context";

/**
 * Prévient la cliente quand la PROFESSIONNELLE annule ou déplace un
 * rendez-vous pris EN LIGNE (la cliente attend alors des emails).
 * Les rendez-vous saisis à la main ne déclenchent aucun email.
 * Tout passe par le client de la professionnelle (RLS) ; une panne d'email
 * n'empêche jamais la modification et reste tracée dans « notifications ».
 */
export async function notifyCustomerOfProChange(
  supabase: SupabaseClient,
  ctx: BusinessContext,
  appointmentId: string,
  kind: Extract<NotificationKind, "booking_cancelled_customer" | "booking_rescheduled_customer">,
  previousStartsAt?: Date | null,
): Promise<"sent" | "failed" | "skipped" | "simulated" | "not_applicable"> {
  try {
    const appt = await getAppointment(supabase, ctx.business.id, appointmentId);
    if (!appt || appt.source !== "online" || (kind === "booking_rescheduled_customer" && new Date(appt.starts_at) < new Date())) return "not_applicable";
    const [customer, items] = await Promise.all([getCustomer(supabase, ctx.business.id, appt.customer_id), listItems(supabase, ctx.business.id, [appt.id])]);
    const recipient = customer?.email;
    if (!recipient) return "not_applicable";

    const { data: row, error } = await supabase
      .from("notifications")
      .insert({ business_id: ctx.business.id, appointment_id: appt.id, kind, recipient })
      .select("id")
      .single();
    if (error || !row) {
      console.error("[notifications] création", { code: error?.code });
      return "failed";
    }

    const s = ctx.settings;
    const email = renderEmail(
      kind,
      {
        businessName: ctx.business.name,
        businessPhone: s?.public_phone ?? null,
        businessEmail: s?.public_email ?? null,
        timeZone: s?.timezone ?? "Europe/Paris",
        reference: appt.id.slice(0, 8).toUpperCase(),
        startsAt: new Date(appt.starts_at),
        durationMinutes: appt.duration_minutes,
        place: appt.place,
        address: appt.place === "home" ? { line1: appt.address_line1, line2: appt.address_line2, postal_code: appt.postal_code, city: appt.city } : null,
        serviceNames: items.map((i) => i.service_name),
        priceTotalCents: appt.price_total_cents,
        depositCents: appt.deposit_amount_cents,
        customerName: `${customer.first_name} ${customer.last_name}`.trim(),
        customerEmail: recipient,
        customerPhone: customer.phone,
        comment: null,
        cancellationPolicy: null,
        cancellationNoticeHours: null,
        previousStartsAt: previousStartsAt ?? null,
        changedBy: "pro",
      },
      { bookingUrl: s?.booking_enabled ? `${getSiteUrl()}${bookingPath(ctx.business.slug)}` : null },
    );
    const result = await sendEmail({ to: recipient, ...email, replyTo: s?.public_email ?? ctx.business.email });
    await supabase
      .from("notifications")
      .update({
        status: result.status,
        sent_at: result.status === "sent" || result.status === "simulated" ? new Date().toISOString() : null,
        provider: result.provider,
        provider_message_id: result.messageId ?? null,
        error: result.error?.slice(0, 500) ?? null,
        attempts: 1,
      })
      .eq("id", row.id);
    return result.status;
  } catch (error) {
    console.error("[notifications] envoi", error);
    return "failed";
  }
}
