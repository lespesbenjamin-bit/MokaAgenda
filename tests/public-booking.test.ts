import { describe, expect, it } from "vitest";
import {
  bookingDays,
  canCustomerChange,
  depositDescription,
  isSlotError,
  publicSlots,
  requiresDeposit,
  toAvailabilityContext,
  translatePublicError,
  PUBLIC_GENERIC_ERROR,
  type PublicAvailabilityRaw,
} from "@/lib/domain/public-booking";
import { isValidSlug, slugify } from "@/lib/domain/slug";
import { bookingSettingsSchema, looksLikeSpam, parseBookingForm, MIN_FILL_MS } from "@/lib/validation/public-booking";
import { escapeHtml, formatDateTime, renderEmail, type EmailBooking } from "@/server/notifications/templates";
import { mailDriver, sendEmail } from "@/server/notifications/mailer";
import { generateManageToken, hashIncomingToken, hashToken } from "@/server/security/tokens";
import { clientIp, hitRateLimit, LIMITS, resetRateLimits } from "@/server/security/rate-limit";

const TZ = "Europe/Paris";
const service = { duration_minutes: 60, prep_minutes: 0, cleanup_minutes: 0, buffer_minutes: 15, min_notice_minutes: 0 };
const raw: PublicAvailabilityRaw = {
  rules: [
    { weekday: 1, start_minute: 540, end_minute: 720, place: "salon" }, // lundi matin institut
    { weekday: 1, start_minute: 840, end_minute: 1080, place: "home" }, // lundi après-midi domicile
    { weekday: 7, start_minute: 120, end_minute: 300, place: null }, // dimanche 2 h–5 h (changement d'heure)
  ],
  blocks: [{ start: "2027-01-11T00:00:00+01:00", end: "2027-01-12T00:00:00+01:00", place: null }],
  busy: [{ start: "2027-01-04T10:00:00Z", end: "2027-01-04T10:30:00Z" }], // 11 h–11 h 30 Paris
};
const ctx = toAvailabilityContext(raw, TZ);
const opts = { now: new Date("2027-01-01T00:00:00Z"), windowDays: 60, stepMinutes: 30 };
const hhmm = (d: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);

describe("créneaux publics (même moteur que l'agenda)", () => {
  it("respecte les plages par lieu, la pause, les rendez-vous existants et le temps tampon", () => {
    const salon = publicSlots("2027-01-04", service, "salon", ctx, opts).map(hhmm);
    // 9 h–12 h, 75 min bloquées (60 + 15) ; 11 h–11 h 30 déjà pris
    expect(salon).toEqual(["09:00", "09:30"]);
    const home = publicSlots("2027-01-04", service, "home", ctx, opts).map(hhmm);
    expect(home[0]).toBe("14:00");
    expect(home.at(-1)).toBe("16:30");
    expect(home).not.toContain("12:00");
  });

  it("ne propose rien un jour fermé ou bloqué", () => {
    expect(publicSlots("2027-01-05", service, "salon", ctx, opts)).toEqual([]);
    expect(publicSlots("2027-01-11", service, "salon", ctx, opts)).toEqual([]);
  });

  it("applique le délai minimum et l'horizon de réservation", () => {
    const now = new Date("2027-01-04T08:00:00Z"); // 9 h Paris
    const withNotice = publicSlots("2027-01-04", { ...service, min_notice_minutes: 120 }, "home", ctx, { ...opts, now }).map(hhmm);
    expect(withNotice[0]).toBe("14:00");
    const salonNotice = publicSlots("2027-01-04", { ...service, min_notice_minutes: 150 }, "salon", ctx, { ...opts, now });
    expect(salonNotice).toEqual([]);
    expect(publicSlots("2027-01-04", service, "home", ctx, { ...opts, now: new Date("2026-10-01T00:00:00Z") })).toEqual([]);
  });

  it("gère le passage à l'heure d'été : aucune heure inexistante proposée", () => {
    const slots = publicSlots("2027-03-28", { ...service, buffer_minutes: 0 }, "salon", ctx, { ...opts, windowDays: 120 }).map(hhmm);
    expect(slots).not.toContain("02:00");
    expect(slots).not.toContain("02:30");
    expect(slots[0]).toBe("03:00");
  });

  it("liste les jours réservables jusqu'à l'horizon", () => {
    const days = bookingDays(new Date("2027-01-04T23:30:00Z"), TZ, 3);
    expect(days).toEqual(["2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08"]);
  });
});

describe("acomptes et règles d'annulation", () => {
  it("une prestation avec acompte n'est pas réservable en ligne (Sprint 6)", () => {
    expect(requiresDeposit({ deposit_type: "none", deposit_value: 0 })).toBe(false);
    expect(requiresDeposit({ deposit_type: "percentage", deposit_value: 30 })).toBe(true);
    expect(requiresDeposit({ deposit_type: "fixed", deposit_value: 0 })).toBe(false);
    expect(depositDescription({ deposit_type: "fixed", deposit_value: 2000 })).toBe("Acompte de 20,00 €");
    expect(depositDescription({ deposit_type: "percentage", deposit_value: 30 })).toBe("Acompte de 30 %");
  });

  it("autorise l'annulation jusqu'au délai, selon les règles de la professionnelle", () => {
    const b = { status: "confirmed", starts_at: "2027-01-10T10:00:00Z", policy: { cancellation_notice_hours: 24, customer_can_cancel: true, customer_can_reschedule: false } };
    expect(canCustomerChange(b, "cancel", new Date("2027-01-09T09:59:00Z"))).toBe(true);
    expect(canCustomerChange(b, "cancel", new Date("2027-01-09T10:01:00Z"))).toBe(false);
    expect(canCustomerChange(b, "reschedule", new Date("2027-01-01T00:00:00Z"))).toBe(false);
    expect(canCustomerChange({ ...b, status: "cancelled" }, "cancel", new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("traduit les erreurs sans jamais exposer de détail technique", () => {
    expect(translatePublicError("MOKA_SLOT_TAKEN").message).toMatch(/vient d'être réservé/);
    expect(translatePublicError('duplicate key value violates "customers_pkey"')).toEqual({ code: null, message: PUBLIC_GENERIC_ERROR });
    expect(isSlotError("MOKA_SLOT_TAKEN")).toBe(true);
    expect(isSlotError("MOKA_INVALID_EMAIL")).toBe(false);
  });
});

describe("adresse publique", () => {
  it("génère un identifiant identique à celui de la base", () => {
    expect(slugify("Institut Élodie & Cœur")).toBe("institut-elodie-coeur");
    expect(slugify("  !!  ")).toBe("pro");
    expect(isValidSlug("institut-elodie")).toBe(true);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("-abc")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
    expect(isValidSlug("Majuscule")).toBe(false);
  });
});

describe("validation du formulaire de réservation", () => {
  const base = {
    slug: "institut-elodie",
    service_id: "8c1f4b0e-3d1a-4a52-9b0e-3f1d2c4b5a6e",
    place: "salon",
    starts_at: "2027-01-04T10:30:00.000Z",
    first_name: "Nina",
    last_name: "Martin",
    email: "Nina@Exemple.FR",
    phone: "+33 6 12 34 56 78",
    accept_terms: "on",
    idempotency_key: "0b5c2f8e-1a3d-4f6b-8c9e-2d4f6a8b0c1e",
  };

  it("accepte une réservation en institut et normalise l'email", () => {
    const r = parseBookingForm(base);
    expect(r.ok && r.data.email).toBe("nina@exemple.fr");
  });

  it("exige l'adresse complète à domicile (code postal à 5 chiffres)", () => {
    const r = parseBookingForm({ ...base, place: "home", address_line1: "3 rue", postal_code: "310", city: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["city", "postal_code"]);
    expect(parseBookingForm({ ...base, place: "home", address_line1: "3 rue", postal_code: "31000", city: "Toulouse" }).ok).toBe(true);
  });

  it("refuse les conditions non acceptées, un téléphone invalide ou un lieu inconnu", () => {
    const r = parseBookingForm({ ...base, accept_terms: undefined, phone: "12", place: "garage" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["accept_terms", "phone", "place"]);
  });

  it("détecte les robots : champ piège rempli ou envoi trop rapide", () => {
    const now = 1_000_000;
    expect(looksLikeSpam("http://spam", now - 10_000, now)).toBe(true);
    expect(looksLikeSpam("", now - 500, now)).toBe(true);
    expect(looksLikeSpam("", "abc", now)).toBe(true);
    expect(looksLikeSpam("", now - MIN_FILL_MS - 1, now)).toBe(false);
  });

  it("valide les réglages de la page publique", () => {
    const ok = bookingSettingsSchema.safeParse({
      booking_enabled: true, slug: "Institut-Elodie", public_description: "", public_phone: "", public_email: "", public_instagram: "@elodie.beaute",
      cancellation_policy: "", booking_terms: "", cancellation_notice_hours: "24", customer_can_cancel: true, customer_can_reschedule: true,
      booking_window_days: "60", slot_step_minutes: "15", notification_email: "",
    });
    expect(ok.success && ok.data).toMatchObject({ slug: "institut-elodie", public_instagram: "elodie.beaute", public_email: null, cancellation_notice_hours: 24 });
    const bad = bookingSettingsSchema.safeParse({ ...(ok.success ? ok.data : {}), slug: "a", slot_step_minutes: 7 });
    expect(bad.success).toBe(false);
  });
});

describe("liens sécurisés", () => {
  it("génère un jeton de 256 bits dont seule l'empreinte est conservée", () => {
    const { token, hash } = generateManageToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
    expect(hashIncomingToken(token)).toBe(hash);
    expect(generateManageToken().token).not.toBe(token);
  });
  it("rejette un jeton malformé", () => {
    expect(hashIncomingToken("../../etc")).toBeNull();
    expect(hashIncomingToken("")).toBeNull();
  });
});

describe("limitation de débit", () => {
  it("bloque au-delà du plafond puis repart après la fenêtre", () => {
    resetRateLimits();
    const { max, windowMs } = LIMITS.booking;
    for (let i = 0; i < max; i++) expect(hitRateLimit("booking", "1.2.3.4", 0)).toBe(true);
    expect(hitRateLimit("booking", "1.2.3.4", 0)).toBe(false);
    expect(hitRateLimit("booking", "5.6.7.8", 0)).toBe(true);
    expect(hitRateLimit("booking", "1.2.3.4", windowMs + 1)).toBe(true);
  });
  it("lit l'adresse IP transmise par Vercel", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("emails", () => {
  const booking: EmailBooking = {
    businessName: "Institut <Élodie>",
    businessPhone: "05 61 00 00 00",
    businessEmail: "contact@elodie.fr",
    timeZone: TZ,
    reference: "AB12CD34",
    startsAt: new Date("2027-01-04T09:30:00Z"),
    durationMinutes: 60,
    place: "home",
    address: { line1: "3 allée des Pins", line2: null, postal_code: "31000", city: "Toulouse" },
    serviceNames: ["Soin éclat"],
    priceTotalCents: 7500,
    depositCents: 0,
    customerName: "Nina Martin",
    customerEmail: "nina@exemple.fr",
    customerPhone: "06 12 34 56 78",
    comment: "<script>alert(1)</script>",
    cancellationPolicy: "Toute annulation tardive est facturée.",
    cancellationNoticeHours: 24,
  };

  it("formate la date dans le fuseau de l'entreprise", () => {
    expect(formatDateTime(booking.startsAt, TZ)).toBe("lundi 4 janvier 2027 à 10 h 30");
    expect(formatDateTime(new Date("2027-01-04T09:00:00Z"), TZ)).toBe("lundi 4 janvier 2027 à 10 h");
  });

  it("confirmation cliente : récapitulatif, lien de gestion, conditions ; sans le commentaire interne", () => {
    const e = renderEmail("booking_confirmed_customer", booking, { manageUrl: "https://moka.test/reservation/abc" });
    expect(e.subject).toBe("Rendez-vous confirmé — Institut <Élodie>");
    expect(e.text).toContain("Soin éclat");
    expect(e.text).toContain("À domicile — 3 allée des Pins, 31000 Toulouse");
    expect(e.text).toContain("75,00 €");
    expect(e.text).toContain("https://moka.test/reservation/abc");
    expect(e.text).toContain("jusqu'à 24 h avant");
    expect(e.html).toContain("Institut &lt;Élodie&gt;");
    expect(e.text).not.toContain("<script>");
  });

  it("notification professionnelle : coordonnées et commentaire échappé", () => {
    const e = renderEmail("booking_new_pro", booking, { agendaUrl: "https://moka.test/agenda/1" });
    expect(e.subject).toContain("Nina Martin");
    expect(e.text).toContain("06 12 34 56 78");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).not.toContain("<script>");
  });

  it("annulation et modification", () => {
    expect(renderEmail("booking_cancelled_customer", { ...booking, changedBy: "pro" }).text).toContain("Institut <Élodie> a annulé");
    const moved = renderEmail("booking_rescheduled_pro", { ...booking, previousStartsAt: new Date("2027-01-03T09:00:00Z") });
    expect(moved.text).toContain("Ancien créneau : dimanche 3 janvier 2027 à 10 h");
    expect(renderEmail("booking_cancelled_pro", booking).subject).toMatch(/^Annulation/);
  });

  it("échappe les caractères HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("la démonstration n'envoie JAMAIS d'email réel, même avec une clé configurée", async () => {
    const env = { NEXT_PUBLIC_APP_ENV: "demo", RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.fr" };
    expect(mailDriver(env)).toBe("simulated");
    let called = false;
    const r = await sendEmail({ to: "x@y.fr", subject: "s", html: "h", text: "t" }, env, (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch);
    expect(r.status).toBe("simulated");
    expect(called).toBe(false);
  });

  it("sans configuration : aucun envoi, statut « non envoyé » explicite", async () => {
    const r = await sendEmail({ to: "x@y.fr", subject: "s", html: "h", text: "t" }, { NEXT_PUBLIC_APP_ENV: "production" });
    expect(r).toMatchObject({ status: "skipped", provider: "disabled" });
  });

  it("avec Resend : envoie et récupère l'identifiant ; signale un échec sans planter", async () => {
    const env = { NEXT_PUBLIC_APP_ENV: "production", RESEND_API_KEY: "re_x", EMAIL_FROM: "Moka <noreply@moka.fr>" };
    let body: Record<string, unknown> = {};
    const ok = await sendEmail({ to: "x@y.fr", subject: "s", html: "h", text: "t", replyTo: "pro@y.fr" }, env, (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    }) as unknown as typeof fetch);
    expect(ok).toEqual({ status: "sent", provider: "resend", messageId: "em_1" });
    expect(body).toMatchObject({ from: "Moka <noreply@moka.fr>", to: ["x@y.fr"], reply_to: "pro@y.fr" });
    const ko = await sendEmail({ to: "x@y.fr", subject: "s", html: "h", text: "t" }, env, (async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 })) as typeof fetch);
    expect(ko.status).toBe("failed");
    expect(ko.error).toContain("domain not verified");
  });
});
