import { z } from "zod";
import { parseEurosToCents, validatePricing, type DepositType, type Place, type ServiceCosts, type ServicePricing } from "@/lib/domain/pricing";

export const MIN_NOTICE_OPTIONS = [
  { value: 0, label: "Aucun délai" },
  { value: 60, label: "1 heure" },
  { value: 120, label: "2 heures" },
  { value: 240, label: "4 heures" },
  { value: 720, label: "12 heures" },
  { value: 1440, label: "24 heures" },
  { value: 2880, label: "48 heures" },
  { value: 4320, label: "3 jours" },
  { value: 10080, label: "1 semaine" },
] as const;

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Indiquez un nom.").max(80, "80 caractères maximum."),
  description: z
    .string()
    .trim()
    .max(500, "500 caractères maximum.")
    .transform((v) => v || null),
  is_visible: z.string().optional().transform((v) => v === "on"),
});

export interface ParsedService {
  values: {
    category_id: string | null;
    name: string;
    description: string | null;
    duration_minutes: number;
    prep_minutes: number;
    cleanup_minutes: number;
    buffer_minutes: number;
    min_notice_minutes: number;
    is_active: boolean;
    online_bookable: boolean;
    base_price_cents: number;
    promo_price_cents: number | null;
    extra_fee_cents: number;
    extra_fee_label: string | null;
    vat_rate_bps: number;
    deposit_type: DepositType;
    deposit_value: number;
  };
  places: Partial<Record<Place, number | null>>;
  costs: ServiceCosts;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lit et valide le formulaire « prestation ». Renvoie soit les valeurs prêtes
 * à enregistrer, soit les erreurs par champ (messages compréhensibles).
 */
export function parseServiceForm(form: Record<string, string | undefined>): { ok: true; data: ParsedService } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const text = (k: string) => (form[k] ?? "").trim();

  const name = text("name");
  if (!name) errors.name = "Indiquez le nom de la prestation.";
  else if (name.length > 120) errors.name = "120 caractères maximum.";

  const description = text("description");
  if (description.length > 2000) errors.description = "2000 caractères maximum.";

  const categoryId = text("category_id");
  if (categoryId && !UUID.test(categoryId)) errors.category_id = "Catégorie invalide.";

  const int = (k: string, min: number, max: number, label: string, fallback?: number) => {
    const raw = text(k);
    if (raw === "" && fallback !== undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors[k] = `${label} : nombre entier entre ${min} et ${max}.`;
      return 0;
    }
    return n;
  };
  const duration = int("duration_minutes", 5, 720, "Durée");
  const prep = int("prep_minutes", 0, 240, "Préparation", 0);
  const cleanup = int("cleanup_minutes", 0, 240, "Nettoyage", 0);
  const buffer = int("buffer_minutes", 0, 240, "Temps tampon", 0);
  const minNotice = int("min_notice_minutes", 0, 43200, "Délai minimum", 0);

  const money = (k: string, { required = false } = {}) => {
    const cents = parseEurosToCents(form[k]);
    if (cents === null) {
      if (required) errors[k] = "Indiquez un montant.";
      return null;
    }
    if (Number.isNaN(cents) || cents < 0) {
      errors[k] = "Montant invalide (exemple : 45 ou 45,50).";
      return null;
    }
    if (cents > 10_000_000) {
      errors[k] = "Montant trop élevé.";
      return null;
    }
    return cents;
  };

  const basePrice = money("base_price", { required: true }) ?? 0;
  const promo = money("promo_price");
  const extraFee = money("extra_fee") ?? 0;
  const extraFeeLabel = text("extra_fee_label").slice(0, 80) || null;

  const vat = Number(text("vat_rate_bps") || "0");
  if (![0, 550, 1000, 2000].includes(vat)) errors.vat_rate_bps = "Choisissez un régime de TVA.";

  const places: ParsedService["places"] = {};
  if (form.offer_salon === "on") places.salon = money("salon_price");
  if (form.offer_home === "on") places.home = money("home_price");

  const depositType = (["none", "fixed", "percentage"].includes(text("deposit_type")) ? text("deposit_type") : "none") as DepositType;
  let depositValue = 0;
  if (depositType === "fixed") depositValue = money("deposit_fixed", { required: true }) ?? 0;
  if (depositType === "percentage") {
    const raw = text("deposit_percent").replace(",", ".");
    const n = Number(raw);
    if (raw === "" || !Number.isInteger(n) || n < 0 || n > 100) errors.deposit_percent = "Pourcentage entier entre 0 et 100.";
    else depositValue = n;
  }

  const costs: ServiceCosts = {
    consumablesCents: money("cost_consumables") ?? 0,
    productsCents: money("cost_products") ?? 0,
    otherCents: money("cost_other") ?? 0,
  };

  if (Object.keys(errors).length === 0) {
    const pricing: ServicePricing = {
      basePriceCents: basePrice,
      promoPriceCents: promo,
      extraFeeCents: extraFee,
      vatRateBps: vat,
      places,
      depositType,
      depositValue,
    };
    const problem = validatePricing(pricing);
    if (problem) {
      const field = /lieu/.test(problem) ? "places" : /promotionnel/.test(problem) ? "promo_price" : /acompte|pourcentage/i.test(problem) ? (depositType === "percentage" ? "deposit_percent" : "deposit_fixed") : "base_price";
      errors[field] = problem;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      values: {
        category_id: categoryId || null,
        name,
        description: description || null,
        duration_minutes: duration,
        prep_minutes: prep,
        cleanup_minutes: cleanup,
        buffer_minutes: buffer,
        min_notice_minutes: minNotice,
        is_active: form.is_active === "on",
        online_bookable: form.online_bookable === "on",
        base_price_cents: basePrice,
        promo_price_cents: promo,
        extra_fee_cents: extraFee,
        extra_fee_label: extraFee > 0 ? extraFeeLabel : null,
        vat_rate_bps: vat,
        deposit_type: depositType,
        deposit_value: depositValue,
      },
      places,
      costs,
    },
  };
}
