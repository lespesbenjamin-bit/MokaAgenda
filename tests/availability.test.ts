import { describe, expect, it } from "vitest";
import { checkSlot, freeSlots, type AvailabilityContext, type SlotRequest } from "@/lib/domain/availability";
import { allowedTransitions, canTransition, translateAppointmentError } from "@/lib/domain/appointments";
import { hhmmToMinute, isoWeekdayOf, localDate, localMinute, minuteToHHMM, zonedToUtc } from "@/lib/domain/time";

const TZ = "Europe/Paris";
// Mêmes scénarios que tests/db/sprint3.test.ts (lundi 4 janvier 2027…)
const ctx: AvailabilityContext = {
  timeZone: TZ,
  rules: [
    { weekday: 1, startMinute: 540, endMinute: 720, place: "salon" },
    { weekday: 1, startMinute: 840, endMinute: 1080, place: "home" },
    { weekday: 2, startMinute: 540, endMinute: 1080, place: null },
    { weekday: 7, startMinute: 540, endMinute: 720, place: null },
  ],
  blocks: [
    { start: new Date("2027-01-12T00:00:00+01:00"), end: new Date("2027-01-13T00:00:00+01:00"), place: null },
    { start: new Date("2027-01-19T09:00:00+01:00"), end: new Date("2027-01-19T12:00:00+01:00"), place: "home" },
  ],
  busy: [{ id: "x", start: new Date("2027-01-05T13:00:00Z"), end: new Date("2027-01-05T13:45:00Z") }],
};
const req = (iso: string, o: Partial<SlotRequest> = {}): SlotRequest => ({
  startsAt: new Date(iso),
  durationMinutes: 60,
  prepMinutes: 0,
  cleanupMinutes: 0,
  bufferMinutes: 0,
  place: "salon",
  ...o,
});
const reason = (r: ReturnType<typeof checkSlot>) => (r.ok ? "ok" : r.reason);

describe("fuseaux horaires", () => {
  it("convertit l'heure locale en instant UTC, heure d'hiver et d'été", () => {
    expect(zonedToUtc("2027-01-04", 600, TZ).toISOString()).toBe("2027-01-04T09:00:00.000Z");
    expect(zonedToUtc("2027-07-05", 600, TZ).toISOString()).toBe("2027-07-05T08:00:00.000Z");
    expect(zonedToUtc("2027-03-28", 540, TZ).toISOString()).toBe("2027-03-28T07:00:00.000Z"); // jour du changement
    expect(zonedToUtc("2027-01-05", 540, "America/Martinique").toISOString()).toBe("2027-01-05T13:00:00.000Z");
  });
  it("donne la date, la minute et le jour locaux", () => {
    const d = new Date("2027-01-04T23:30:00Z"); // 00:30 le 5 à Paris
    expect(localDate(d, TZ)).toBe("2027-01-05");
    expect(localMinute(d, TZ)).toBe(30);
    expect(isoWeekdayOf("2027-01-04")).toBe(1);
    expect(isoWeekdayOf("2027-01-10")).toBe(7);
  });
  it("lit et écrit les heures", () => {
    expect(hhmmToMinute("09:30")).toBe(570);
    expect(hhmmToMinute("24:00")).toBe(1440);
    expect(hhmmToMinute("25:00")).toBeNull();
    expect(minuteToHHMM(1080)).toBe("18:00");
  });
});

describe("contrôle d'un créneau (identique à PostgreSQL)", () => {
  it("accepte un créneau dans les horaires", () => {
    expect(reason(checkSlot(req("2027-01-04T09:00:00Z"), ctx))).toBe("ok");
  });
  it("refuse pause, dépassement, jour fermé, avant l'ouverture", () => {
    expect(reason(checkSlot(req("2027-01-04T11:30:00Z"), ctx))).toBe("outside_hours");
    expect(reason(checkSlot(req("2027-01-04T10:30:00Z"), ctx))).toBe("outside_hours");
    expect(reason(checkSlot(req("2027-01-06T09:00:00Z"), ctx))).toBe("outside_hours");
    expect(reason(checkSlot(req("2027-01-05T07:30:00Z"), ctx))).toBe("outside_hours");
  });
  it("respecte le lieu de chaque plage", () => {
    expect(reason(checkSlot(req("2027-01-04T08:00:00Z", { place: "home" }), ctx))).toBe("outside_hours");
    expect(reason(checkSlot(req("2027-01-04T14:00:00Z"), ctx))).toBe("outside_hours");
    expect(reason(checkSlot(req("2027-01-04T14:00:00Z", { place: "home" }), ctx))).toBe("ok");
  });
  it("refuse les périodes bloquées selon le lieu", () => {
    expect(reason(checkSlot(req("2027-01-12T09:00:00Z"), ctx))).toBe("blocked");
    expect(reason(checkSlot(req("2027-01-19T09:00:00Z"), ctx))).toBe("ok");
    expect(reason(checkSlot(req("2027-01-19T08:00:00Z", { place: "home" }), ctx))).toBe("blocked");
  });
  it("tient compte de la préparation et du tampon pour les conflits", () => {
    expect(reason(checkSlot(req("2027-01-05T13:40:00Z", { durationMinutes: 30 }), ctx))).toBe("conflict");
    expect(reason(checkSlot(req("2027-01-05T14:00:00Z", { durationMinutes: 30, prepMinutes: 20 }), ctx))).toBe("conflict");
    expect(reason(checkSlot(req("2027-01-05T13:45:00Z", { durationMinutes: 30 }), ctx))).toBe("ok");
  });
  it("ignore le rendez-vous qu'on déplace", () => {
    expect(reason(checkSlot(req("2027-01-05T13:00:00Z", { durationMinutes: 30 }), { ...ctx, ignoreId: "x" }))).toBe("ok");
  });
  it("gère le jour du passage à l'heure d'été", () => {
    expect(reason(checkSlot(req("2027-03-28T07:00:00Z"), ctx))).toBe("ok");
    expect(reason(checkSlot(req("2027-03-28T06:30:00Z"), ctx))).toBe("outside_hours");
    expect(reason(checkSlot(req("2027-03-28T09:30:00Z"), ctx))).toBe("outside_hours");
  });
});

describe("créneaux libres", () => {
  it("liste les débuts possibles d'une journée, pauses et rendez-vous exclus", () => {
    const slots = freeSlots("2027-01-05", { durationMinutes: 60, prepMinutes: 0, cleanupMinutes: 0, bufferMinutes: 0, place: "salon" }, ctx, { stepMinutes: 60 });
    const local = slots.map((d) => localMinute(d, TZ) / 60);
    expect(local).toEqual([9, 10, 11, 12, 13, 15, 16, 17]); // 13h-14h libre (finit pile au début du rendez-vous), 14h occupé
  });
  it("respecte le délai minimum avant réservation", () => {
    const slots = freeSlots("2027-01-04", { durationMinutes: 60, prepMinutes: 0, cleanupMinutes: 0, bufferMinutes: 0, place: "salon" }, ctx, {
      stepMinutes: 60,
      notBefore: new Date("2027-01-04T09:30:00Z"),
    });
    expect(slots.map((d) => localMinute(d, TZ) / 60)).toEqual([11]);
  });
  it("ne propose rien un jour fermé ou bloqué", () => {
    const r = { durationMinutes: 30, prepMinutes: 0, cleanupMinutes: 0, bufferMinutes: 0, place: "salon" as const };
    expect(freeSlots("2027-01-06", r, ctx)).toEqual([]);
    expect(freeSlots("2027-01-12", r, ctx)).toEqual([]);
  });
});

describe("statuts", () => {
  const past = new Date("2026-01-01T10:00:00Z");
  const future = new Date("2099-01-01T10:00:00Z");
  it("suit les transitions autorisées", () => {
    expect(allowedTransitions("pending", future)).toEqual(["confirmed", "cancelled"]);
    expect(allowedTransitions("confirmed", future)).toEqual(["cancelled"]);
    expect(allowedTransitions("confirmed", past)).toEqual(["completed", "cancelled", "no_show"]);
    expect(allowedTransitions("cancelled", past)).toEqual([]);
    expect(canTransition("confirmed", "pending", past)).toBe(false);
  });
  it("traduit les refus de la base", () => {
    expect(translateAppointmentError('conflicting key value violates exclusion constraint "appointments_no_overlap"')).toMatch(/chevauche/);
    expect(translateAppointmentError("MOKA_OUTSIDE_HOURS")).toMatch(/horaires/);
    expect(translateAppointmentError("MOKA_BLOCKED_PERIOD")).toMatch(/congé/);
    expect(translateAppointmentError("MOKA_APPOINTMENT_LOCKED")).toMatch(/clôturé/);
  });
});
