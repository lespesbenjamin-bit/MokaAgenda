import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { FormAlert } from "@/components/ui/form-alert";
import { AgendaCalendar } from "@/components/agenda/agenda-calendar";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { listRules } from "@/server/repositories/agenda";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage({ searchParams }: PageProps<"/agenda">) {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const rules = await listRules(supabase, ctx.business.id);
  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;
  return (
    <>
      <PageHeader title="Agenda" description="Vos rendez-vous à domicile et en institut. Cliquez sur un créneau libre pour en créer un." />
      {sp.annule === "1" && (
        <div className="mb-4">
          <FormAlert type="success">Rendez-vous annulé : le créneau est de nouveau libre.</FormAlert>
        </div>
      )}
      <AgendaCalendar timeZone={ctx.settings?.timezone ?? "Europe/Paris"} hasRules={rules.length > 0} initialDate={date} />
    </>
  );
}
