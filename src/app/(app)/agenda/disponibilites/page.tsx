import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ExceptionsManager, WeeklyHoursEditor } from "@/components/agenda/availability-editor";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { listExceptions, listRules } from "@/server/repositories/agenda";
import { localDate } from "@/lib/domain/time";

export const metadata: Metadata = { title: "Horaires et disponibilités" };

export default async function AvailabilityPage() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const timeZone = ctx.settings?.timezone ?? "Europe/Paris";
  const now = new Date();
  const [rules, exceptions] = await Promise.all([listRules(supabase, ctx.business.id), listExceptions(supabase, ctx.business.id, now)]);
  const hybrid = ctx.business.activity_mode === "hybrid";
  const canEdit = ctx.role === "business_owner";
  const fmt = new Intl.DateTimeFormat("fr-FR", { timeZone, dateStyle: "medium", timeStyle: "short" });
  const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone, dateStyle: "medium" });
  const describe = (s: Date, e: Date) => {
    const allDay = fmt.format(s).endsWith("00:00") && fmt.format(e).endsWith("00:00");
    if (allDay) {
      const last = new Date(e.getTime() - 1);
      return localDate(s, timeZone) === localDate(last, timeZone) ? `Le ${dayFmt.format(s)}` : `Du ${dayFmt.format(s)} au ${dayFmt.format(last)}`;
    }
    return `Du ${fmt.format(s)} au ${fmt.format(e)}`;
  };

  return (
    <>
      <Link href="/agenda" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Agenda
      </Link>
      <PageHeader
        title="Horaires et disponibilités"
        description={`Les rendez-vous ne peuvent être pris que dans ces plages (fuseau : ${timeZone}). Préparation et temps tampon des prestations doivent aussi y tenir.`}
      />
      <div className="flex flex-col gap-6">
        <WeeklyHoursEditor initial={rules} hybrid={hybrid} canEdit={canEdit} />
        <ExceptionsManager
          hybrid={hybrid}
          canEdit={canEdit}
          today={localDate(now, timeZone)}
          items={exceptions.map((e) => ({ id: e.id, kind: e.kind, label: e.label, place: e.place, period: describe(new Date(e.starts_at), new Date(e.ends_at)) }))}
        />
      </div>
    </>
  );
}
