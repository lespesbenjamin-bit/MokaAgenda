import { parseEurosToCents, type Place } from "@/lib/domain/pricing";
import { hhmmToMinute } from "@/lib/domain/time";
import { customerSchema } from "./customers";
import { toFieldErrors } from "./auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedAppointmentForm {
  customer: { mode: "existing"; id: string } | { mode: "new"; first_name: string; last_name: string; phone: string | null; email: string | null };
  serviceId: string;
  place: Place;
  date: string;
  minute: number;
  durationMinutes: number | null; // null = durée de la prestation
  priceCents: number | null; // null = tarif du catalogue
  address: { addressId: string | null; line1: string; line2: string | null; postalCode: string | null; city: string } | null;
  notes: string | null;
  status: "pending" | "confirmed";
}

/**
 * Lit le formulaire de rendez-vous. La cohérence métier (horaires,
 * conflits) est vérifiée ensuite côté serveur puis par PostgreSQL.
 */
export function parseAppointmentForm(
  form: Record<string, string | undefined>,
  { requireCustomer = true }: { requireCustomer?: boolean } = {},
): { ok: true; data: ParsedAppointmentForm } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const t = (k: string) => (form[k] ?? "").trim();

  let customer: ParsedAppointmentForm["customer"] = { mode: "existing", id: "" };
  if (requireCustomer) {
    if (t("customer_mode") === "new") {
      const parsed = customerSchema.safeParse({ first_name: t("new_first_name"), last_name: t("new_last_name"), phone: t("new_phone"), email: t("new_email") });
      if (!parsed.success) {
        for (const [k, v] of Object.entries(toFieldErrors(parsed.error))) errors[`new_${k}`] = v;
      } else {
        customer = { mode: "new", first_name: parsed.data.first_name, last_name: parsed.data.last_name, phone: parsed.data.phone, email: parsed.data.email };
      }
    } else if (!UUID.test(t("customer_id"))) {
      errors.customer_id = "Choisissez une cliente ou créez-en une nouvelle.";
    } else {
      customer = { mode: "existing", id: t("customer_id") };
    }
  }

  if (!UUID.test(t("service_id"))) errors.service_id = "Choisissez une prestation.";

  const place = t("place");
  if (place !== "home" && place !== "salon") errors.place = "Choisissez : à domicile ou en institut.";

  const date = t("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) errors.date = "Date invalide.";

  const minute = hhmmToMinute(t("time"));
  if (minute === null || minute >= 1440) errors.time = "Heure invalide (exemple : 14:30).";

  let durationMinutes: number | null = null;
  if (t("duration_minutes")) {
    const n = Number(t("duration_minutes"));
    if (!Number.isInteger(n) || n < 5 || n > 720) errors.duration_minutes = "Durée entre 5 et 720 minutes.";
    else durationMinutes = n;
  }

  let priceCents: number | null = null;
  if (t("price")) {
    const c = parseEurosToCents(t("price"));
    if (c === null || Number.isNaN(c) || c < 0 || c > 10_000_000) errors.price = "Montant invalide (exemple : 45 ou 45,50).";
    else priceCents = c;
  }

  let address: ParsedAppointmentForm["address"] = null;
  if (place === "home") {
    const choice = t("address_choice");
    const line1 = t("address_line1");
    const city = t("city");
    if (!line1 || !city) {
      errors.address_line1 = "Indiquez l'adresse d'intervention (adresse et ville).";
    } else if (line1.length > 200 || city.length > 100) {
      errors.address_line1 = "Adresse trop longue.";
    } else {
      address = {
        addressId: UUID.test(choice) ? choice : null,
        line1,
        line2: t("address_line2") || null,
        postalCode: t("postal_code") || null,
        city,
      };
    }
  }

  const notes = t("notes_internal");
  if (notes.length > 2000) errors.notes_internal = "2000 caractères maximum.";

  const status = t("status") === "pending" ? "pending" : "confirmed";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: { customer, serviceId: t("service_id"), place: place as Place, date, minute: minute!, durationMinutes, priceCents, address, notes: notes || null, status },
  };
}
