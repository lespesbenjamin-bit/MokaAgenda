import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { AppointmentForm } from "@/components/agenda/appointment-form";
import { loadAppointmentFormData } from "@/server/services/agenda-page-data";
import { localDate, localMinute, minuteToHHMM } from "@/lib/domain/time";

export const metadata: Metadata = { title: "Nouveau rendez-vous" };

export default async function NewAppointmentPage({ searchParams }: PageProps<"/agenda/nouveau">) {
  const { services, customers, allowedPlaces, timeZone } = await loadAppointmentFormData();
  const sp = await searchParams;
  const raw = typeof sp.debut === "string" ? new Date(sp.debut) : null;
  const start = raw && !Number.isNaN(raw.getTime()) ? raw : null;
  const preselected = typeof sp.cliente === "string" ? sp.cliente : "";
  const now = new Date();
  const roundedNow = minuteToHHMM(Math.min(1425, Math.ceil(localMinute(now, timeZone) / 15) * 15));

  return (
    <>
      <PageHeader title="Nouveau rendez-vous" description="Durée et tarif sont repris de la prestation ; vous pouvez les ajuster pour ce rendez-vous." />
      <AppointmentForm
        services={services}
        customers={customers}
        allowedPlaces={allowedPlaces}
        defaults={{
          customerId: customers.some((c) => c.id === preselected) ? preselected : "",
          serviceId: "",
          place: allowedPlaces.length === 1 ? allowedPlaces[0] : "",
          date: localDate(start ?? now, timeZone),
          time: start ? minuteToHHMM(localMinute(start, timeZone)) : roundedNow,
          duration: "",
          price: "",
          addressId: "",
          addressLine1: "",
          addressLine2: "",
          postalCode: "",
          city: "",
          notes: "",
        }}
      />
    </>
  );
}
