import { centsToInput, type Place } from "@/lib/domain/pricing";

export interface ServiceFormDefaults {
  id?: string;
  name: string;
  category_id: string;
  description: string;
  duration_minutes: string;
  prep_minutes: string;
  cleanup_minutes: string;
  buffer_minutes: string;
  min_notice_minutes: string;
  is_active: boolean;
  online_bookable: boolean;
  base_price: string;
  promo_price: string;
  extra_fee: string;
  extra_fee_label: string;
  vat_rate_bps: string;
  offer_salon: boolean;
  salon_price: string;
  offer_home: boolean;
  home_price: string;
  deposit_type: "none" | "fixed" | "percentage";
  deposit_fixed: string;
  deposit_percent: string;
  cost_consumables: string;
  cost_products: string;
  cost_other: string;
  photoUrl: string | null;
}

export const EMPTY_SERVICE: ServiceFormDefaults = {
  name: "",
  category_id: "",
  description: "",
  duration_minutes: "60",
  prep_minutes: "0",
  cleanup_minutes: "0",
  buffer_minutes: "0",
  min_notice_minutes: "0",
  is_active: true,
  online_bookable: true,
  base_price: "",
  promo_price: "",
  extra_fee: "",
  extra_fee_label: "",
  vat_rate_bps: "0",
  offer_salon: true,
  salon_price: "",
  offer_home: false,
  home_price: "",
  deposit_type: "none",
  deposit_fixed: "",
  deposit_percent: "",
  cost_consumables: "",
  cost_products: "",
  cost_other: "",
  photoUrl: null,
};

/** Convertit une prestation enregistrée en valeurs de formulaire. */
export function toFormDefaults(s: {
  id: string;
  name: string;
  category_id: string | null;
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
  deposit_type: "none" | "fixed" | "percentage";
  deposit_value: number;
  places: Partial<Record<Place, number | null>>;
  costs: { consumablesCents: number; productsCents: number; otherCents: number };
  photoUrl: string | null;
}): ServiceFormDefaults {
  const money = (c: number | null | undefined) => (c ? centsToInput(c) : "");
  return {
    id: s.id,
    name: s.name,
    category_id: s.category_id ?? "",
    description: s.description ?? "",
    duration_minutes: String(s.duration_minutes),
    prep_minutes: String(s.prep_minutes),
    cleanup_minutes: String(s.cleanup_minutes),
    buffer_minutes: String(s.buffer_minutes),
    min_notice_minutes: String(s.min_notice_minutes),
    is_active: s.is_active,
    online_bookable: s.online_bookable,
    base_price: centsToInput(s.base_price_cents),
    promo_price: s.promo_price_cents != null ? centsToInput(s.promo_price_cents) : "",
    extra_fee: money(s.extra_fee_cents),
    extra_fee_label: s.extra_fee_label ?? "",
    vat_rate_bps: String(s.vat_rate_bps),
    offer_salon: "salon" in s.places,
    salon_price: s.places.salon != null ? centsToInput(s.places.salon) : "",
    offer_home: "home" in s.places,
    home_price: s.places.home != null ? centsToInput(s.places.home) : "",
    deposit_type: s.deposit_type,
    deposit_fixed: s.deposit_type === "fixed" ? centsToInput(s.deposit_value) : "",
    deposit_percent: s.deposit_type === "percentage" ? String(s.deposit_value) : "",
    cost_consumables: money(s.costs.consumablesCents),
    cost_products: money(s.costs.productsCents),
    cost_other: money(s.costs.otherCents),
    photoUrl: s.photoUrl,
  };
}
