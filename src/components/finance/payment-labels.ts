export const METHOD_LABELS: Record<string, string> = { card_online: "Carte en ligne (Stripe)", card_terminal: "Carte (terminal)", cash: "Espèces", transfer: "Virement", check: "Chèque", other: "Autre" };
export const KIND_LABELS: Record<string, string> = { deposit: "Arrhes / acompte", balance: "Solde", other: "Autre" };
export const PAYMENT_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "À valider", tone: "bg-warning-soft text-warning" },
  succeeded: { label: "Encaissé", tone: "bg-success-soft text-success" },
  cancelled: { label: "Annulé", tone: "bg-secondary text-muted-foreground" },
  failed: { label: "Échoué", tone: "bg-secondary text-muted-foreground" },
};
export const REFUND_STATUS: Record<string, string> = { requested: "demandé", pending: "en cours chez Stripe", succeeded: "effectué", failed: "échoué", canceled: "annulé" };
export const REFUND_REASON: Record<string, string> = { customer_request: "demande de la cliente", cancellation: "annulation", slot_unavailable: "créneau indisponible (automatique)", duplicate: "doublon", amount_mismatch: "montant incohérent (automatique)", other: "autre" };
