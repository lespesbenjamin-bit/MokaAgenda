import fixtures from "../../../supabase/demo/fixtures.json";

/** Données fictives versionnées de l'environnement démo. */
export const demoFixtures = fixtures;
export type DemoFixtures = typeof fixtures;

/** Rendez-vous d'exemple datés à partir d'aujourd'hui (affichage démo uniquement). */
export function demoUpcomingAppointments(now = new Date()) {
  return fixtures.appointments.map((a) => {
    const date = new Date(now);
    date.setDate(date.getDate() + a.day_offset);
    const [h, m] = a.time.split(":").map(Number);
    date.setHours(h, m, 0, 0);
    return {
      date,
      customer: `${fixtures.customers[a.customer].first_name} ${fixtures.customers[a.customer].last_name}`,
      service: fixtures.services[a.service].name,
      where: a.where as "home" | "salon",
      status: a.status as "confirmed" | "pending",
    };
  });
}
