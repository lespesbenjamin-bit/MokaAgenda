/**
 * Calculs de tarification, d'acompte et de rentabilité indicative.
 * Fonctions pures (aucun accès réseau), utilisées par l'interface, les
 * actions serveur et, au Sprint 3, par la création de rendez-vous.
 *
 * Conventions :
 * - tous les montants sont en CENTIMES entiers ;
 * - les prix saisis sont TTC (ce que paie la cliente) ;
 * - la TVA est en points de base : 2000 = 20 %, 0 = TVA non applicable (franchise).
 */

export type Place = "home" | "salon";
export type DepositType = "none" | "fixed" | "percentage";
export type VatRateBps = 0 | 550 | 1000 | 2000;

export const VAT_OPTIONS: { value: VatRateBps; label: string }[] = [
  { value: 0, label: "TVA non applicable (franchise en base)" },
  { value: 2000, label: "TVA 20 %" },
  { value: 1000, label: "TVA 10 %" },
  { value: 550, label: "TVA 5,5 %" },
];

export interface ServicePricing {
  basePriceCents: number;
  promoPriceCents: number | null;
  extraFeeCents: number;
  vatRateBps: number;
  /** Tarif propre à chaque lieu proposé (null = prix de base). Absent = lieu non proposé. */
  places: Partial<Record<Place, number | null>>;
  depositType: DepositType;
  /** Centimes si fixe, pourcentage (0–100) si pourcentage. */
  depositValue: number;
}

export interface ServiceCosts {
  consumablesCents: number;
  productsCents: number;
  otherCents: number;
}

export interface ServiceTimes {
  durationMinutes: number;
  prepMinutes: number;
  cleanupMinutes: number;
  bufferMinutes: number;
}

export function isPlaceOffered(p: ServicePricing, place: Place): boolean {
  return place in p.places;
}

export function offeredPlaces(p: ServicePricing): Place[] {
  return (["salon", "home"] as const).filter((pl) => isPlaceOffered(p, pl));
}

/** Prix catalogue pour un lieu : tarif du lieu s'il est défini, sinon prix de base. */
export function listPriceCents(p: ServicePricing, place: Place): number {
  const own = p.places[place];
  return own ?? p.basePriceCents;
}

/**
 * Prix de la prestation pour un lieu, hors supplément.
 * Le prix promotionnel s'applique s'il est inférieur au prix catalogue du lieu.
 */
export function unitPriceCents(p: ServicePricing, place: Place): number {
  const list = listPriceCents(p, place);
  return p.promoPriceCents != null && p.promoPriceCents < list ? p.promoPriceCents : list;
}

/** Prix total TTC payé par la cliente pour un lieu (prix + supplément). */
export function totalPriceCents(p: ServicePricing, place: Place): number {
  return unitPriceCents(p, place) + p.extraFeeCents;
}

/** Montant HT correspondant à un montant TTC. */
export function excludingVatCents(ttcCents: number, vatRateBps: number): number {
  if (vatRateBps <= 0) return ttcCents;
  return Math.round((ttcCents * 10000) / (10000 + vatRateBps));
}

/** Montant de l'acompte pour un total TTC donné (jamais supérieur au total). */
export function depositAmountCents(p: Pick<ServicePricing, "depositType" | "depositValue">, totalCents: number): number {
  if (p.depositType === "fixed") return Math.min(p.depositValue, totalCents);
  if (p.depositType === "percentage") return Math.round((totalCents * p.depositValue) / 100);
  return 0;
}

/**
 * Validation des acomptes : montant non négatif, pourcentage entre 0 et 100,
 * acompte fixe ne dépassant pas le prix total le plus bas parmi les lieux proposés.
 */
export function validateDeposit(p: ServicePricing): string | null {
  if (!Number.isInteger(p.depositValue) || p.depositValue < 0) return "L'acompte ne peut pas être négatif.";
  if (p.depositType === "none") return null;
  if (p.depositType === "percentage") {
    return p.depositValue <= 100 ? null : "Le pourcentage d'acompte doit être compris entre 0 et 100.";
  }
  const places = offeredPlaces(p);
  const lowest = Math.min(...(places.length ? places : (["salon"] as Place[])).map((pl) => totalPriceCents(p, pl)));
  return p.depositValue <= lowest
    ? null
    : `L'acompte fixe ne peut pas dépasser le prix de la prestation (${formatEuros(lowest)}).`;
}

/** Validations de cohérence de la tarification (en plus des contraintes de la base). */
export function validatePricing(p: ServicePricing): string | null {
  const amounts = [p.basePriceCents, p.extraFeeCents, p.promoPriceCents ?? 0, ...Object.values(p.places).map((v) => v ?? 0)];
  if (amounts.some((a) => !Number.isInteger(a) || a < 0)) return "Les montants ne peuvent pas être négatifs.";
  if (p.promoPriceCents != null && p.promoPriceCents > p.basePriceCents)
    return "Le prix promotionnel doit être inférieur ou égal au prix de vente.";
  if (offeredPlaces(p).length === 0) return "Indiquez au moins un lieu : à domicile ou en institut.";
  return validateDeposit(p);
}

export function totalCostsCents(c: ServiceCosts): number {
  return c.consumablesCents + c.productsCents + c.otherCents;
}

/** Temps total mobilisé : préparation + prestation + nettoyage. */
export function totalMobilizedMinutes(t: Pick<ServiceTimes, "durationMinutes" | "prepMinutes" | "cleanupMinutes">): number {
  return t.prepMinutes + t.durationMinutes + t.cleanupMinutes;
}

export interface IndicativeMargin {
  place: Place;
  priceTtcCents: number;
  priceHtCents: number;
  consumablesCents: number;
  otherDirectCostsCents: number;
  /** Prix HT − coûts directs. Marge contributive AVANT déplacement, cotisations et charges fixes. */
  contributionCents: number;
  /** Marge / prix HT, en pourcentage arrondi à 0,1. null si prix nul. */
  marginRatePct: number | null;
}

/**
 * Marge contributive indicative AVANT déplacement.
 * Ce n'est PAS un bénéfice net : elle n'inclut ni les frais de trajet,
 * ni les cotisations sociales, ni les charges fixes.
 */
export function indicativeMargin(p: ServicePricing, c: ServiceCosts, place: Place): IndicativeMargin {
  const ttc = totalPriceCents(p, place);
  const ht = excludingVatCents(ttc, p.vatRateBps);
  const consumables = c.consumablesCents;
  const otherDirect = c.productsCents + c.otherCents;
  const contribution = ht - consumables - otherDirect;
  return {
    place,
    priceTtcCents: ttc,
    priceHtCents: ht,
    consumablesCents: consumables,
    otherDirectCostsCents: otherDirect,
    contributionCents: contribution,
    marginRatePct: ht > 0 ? Math.round((contribution / ht) * 1000) / 10 : null,
  };
}

/**
 * Instantané financier figé au moment d'un rendez-vous (Sprint 3+).
 * Les prix du catalogue peuvent changer ensuite sans modifier l'historique.
 */
export interface AppointmentPriceSnapshot {
  serviceId: string;
  serviceName: string;
  place: Place;
  durationMinutes: number;
  mobilizedMinutes: number;
  bufferMinutes: number;
  priceTtcCents: number;
  priceHtCents: number;
  vatRateBps: number;
  extraFeeCents: number;
  depositType: DepositType;
  depositAmountCents: number;
  balanceDueCents: number;
  directCostsCents: number;
  capturedAt: string;
}

export function buildPriceSnapshot(
  service: { id: string; name: string } & ServiceTimes,
  p: ServicePricing,
  c: ServiceCosts,
  place: Place,
  now: Date = new Date(),
): AppointmentPriceSnapshot {
  if (!isPlaceOffered(p, place)) throw new Error(`Prestation non proposée : ${place === "home" ? "à domicile" : "en institut"}`);
  const total = totalPriceCents(p, place);
  const deposit = depositAmountCents(p, total);
  return {
    serviceId: service.id,
    serviceName: service.name,
    place,
    durationMinutes: service.durationMinutes,
    mobilizedMinutes: totalMobilizedMinutes(service),
    bufferMinutes: service.bufferMinutes,
    priceTtcCents: total,
    priceHtCents: excludingVatCents(total, p.vatRateBps),
    vatRateBps: p.vatRateBps,
    extraFeeCents: p.extraFeeCents,
    depositType: p.depositType,
    depositAmountCents: deposit,
    balanceDueCents: total - deposit,
    directCostsCents: totalCostsCents(c),
    capturedAt: now.toISOString(),
  };
}

// ─── Formatage et saisie ────────────────────────────────────────────

const eurFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function formatEuros(cents: number): string {
  return eurFormatter.format(cents / 100).replace(/ | /g, " ");
}

/** "45", "45,50", "45.5", "1 200,00 €" → centimes. null si vide, NaN si invalide. */
export function parseEurosToCents(input: string | null | undefined): number | null {
  const raw = (input ?? "").replace(/[€\s  ]/g, "");
  if (raw === "") return null;
  if (!/^-?\d+([.,]\d{1,2})?$/.test(raw)) return Number.NaN;
  return Math.round(Number(raw.replace(",", ".")) * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
