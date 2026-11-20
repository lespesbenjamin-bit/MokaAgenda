/**
 * Statuts et règles des rendez-vous — identiques au déclencheur PostgreSQL
 * `private.appointment_check_status`.
 */
import { REFUSAL_MESSAGES } from "./availability";

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmé",
  completed: "Terminé",
  cancelled: "Annulé",
  no_show: "Cliente absente",
};

export const ACTIVE_STATUSES: AppointmentStatus[] = ["pending", "confirmed"];
export const CLOSED_STATUSES: AppointmentStatus[] = ["completed", "cancelled", "no_show"];

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** Statuts accessibles depuis un statut donné, à un instant donné. */
export function allowedTransitions(from: AppointmentStatus, startsAt: Date, now: Date = new Date()): AppointmentStatus[] {
  return TRANSITIONS[from].filter((to) => !((to === "completed" || to === "no_show") && startsAt > now));
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus, startsAt: Date, now: Date = new Date()): boolean {
  return allowedTransitions(from, startsAt, now).includes(to);
}

export function isEditable(status: AppointmentStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export const EVENT_LABELS: Record<string, string> = {
  created: "Rendez-vous créé",
  updated: "Rendez-vous modifié",
  rescheduled: "Rendez-vous déplacé",
  status_changed: "Statut modifié",
  cancelled: "Rendez-vous annulé",
};

/** Traduit une erreur de la base en message compréhensible. */
export function translateAppointmentError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("appointments_no_overlap")) return REFUSAL_MESSAGES.conflict;
  if (m.includes("MOKA_OUTSIDE_HOURS")) return REFUSAL_MESSAGES.outside_hours;
  if (m.includes("MOKA_BLOCKED_PERIOD")) return REFUSAL_MESSAGES.blocked;
  if (m.includes("MOKA_STATUS_TRANSITION")) return "Ce changement de statut n'est pas autorisé.";
  if (m.includes("MOKA_STATUS_NOT_ALLOWED")) return "Ce rendez-vous n'a pas encore eu lieu : il ne peut pas être marqué terminé ou absent.";
  if (m.includes("MOKA_APPOINTMENT_LOCKED")) return "Ce rendez-vous est clôturé (terminé, annulé ou absent) et ne peut plus être modifié.";
  if (m.includes("MOKA_NO_SERVICE")) return "Choisissez au moins une prestation.";
  if (m.includes("MOKA_NOT_FOUND")) return "Rendez-vous introuvable.";
  if (m.includes("appointments_home_address")) return "Indiquez l'adresse d'intervention pour un rendez-vous à domicile.";
  if (m.includes("availability_rules_no_overlap")) return "Cette plage chevauche une autre plage du même jour.";
  if (m.includes("MOKA_TRAVEL_TOO_SHORT")) return "Le temps de trajet avec un rendez-vous voisin ne tient pas (marge de sécurité comprise).";
  if (m.includes("MOKA_TRAVEL_UNKNOWN")) return "Le temps de trajet avec un rendez-vous voisin n'a pas pu être vérifié. Réessayez, ou enregistrez sans vérifier le trajet.";
  if (m.includes("MOKA_ADDRESS_NOT_VERIFIED")) return "Adresse non localisée : impossible de vérifier les trajets.";
  if (m.includes("MOKA_PLAN_OUTDATED")) return "L'agenda a changé depuis la proposition : relancez l'optimisation.";
  return "L'enregistrement a échoué. Réessayez dans un instant.";
}

export const WEEKDAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

export const EXCEPTION_KIND_LABELS = {
  vacation: "Congés",
  closure: "Fermeture exceptionnelle",
  unavailable: "Indisponibilité ponctuelle",
} as const;
