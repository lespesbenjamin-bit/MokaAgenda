"use client";

import { useActionState, useState } from "react";
import { CalendarClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { SlotPicker } from "./slot-picker";
import { cancelPublicBookingAction, reschedulePublicBookingAction, type ManageState } from "@/server/actions/public-booking";

/** Actions de la cliente sur son rendez-vous (lien sécurisé). */
export function ManageBooking({
  token,
  slug,
  serviceId,
  place,
  timeZone,
  today,
  lastDay,
  canCancel,
  canReschedule,
}: {
  token: string;
  slug: string;
  serviceId: string | null;
  place: "salon" | "home";
  timeZone: string;
  today: string;
  lastDay: string;
  canCancel: boolean;
  canReschedule: boolean;
}) {
  const [mode, setMode] = useState<"none" | "cancel" | "reschedule">("none");
  const [cancelState, cancelAction] = useActionState<ManageState, FormData>(cancelPublicBookingAction.bind(null, token), {});
  const [moveState, moveAction] = useActionState<ManageState, FormData>(reschedulePublicBookingAction.bind(null, token), {});
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-4">
      {mode === "none" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {canReschedule && serviceId && (
            <Button type="button" variant="outline" onClick={() => setMode("reschedule")}>
              <CalendarClock /> Déplacer le rendez-vous
            </Button>
          )}
          {canCancel && (
            <Button type="button" variant="outline" onClick={() => setMode("cancel")}>
              <X /> Annuler le rendez-vous
            </Button>
          )}
        </div>
      )}

      {mode === "cancel" && (
        <form action={cancelAction} className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <p className="font-semibold">Annuler ce rendez-vous ?</p>
          {cancelState.error && <FormAlert type="error">{cancelState.error}</FormAlert>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">Motif (facultatif)</Label>
            <Textarea id="reason" name="reason" maxLength={500} placeholder="Ce message sera transmis à la professionnelle" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SubmitButton pendingLabel="Annulation…">Confirmer l&apos;annulation</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setMode("none")}>
              Garder mon rendez-vous
            </Button>
          </div>
        </form>
      )}

      {mode === "reschedule" && serviceId && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
          <p className="font-semibold">Choisissez un nouveau créneau</p>
          {moveState.error && <FormAlert type="error">{moveState.error}</FormAlert>}
          <SlotPicker
            slug={slug}
            serviceId={serviceId}
            place={place}
            timeZone={timeZone}
            today={today}
            lastDay={lastDay}
            selected={startsAt}
            onSelect={setStartsAt}
            token={token}
            refreshKey={moveState.slotUnavailable ? 1 : 0}
          />
          <form action={moveAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="starts_at" value={startsAt ?? ""} />
            <SubmitButton disabled={!startsAt} pendingLabel="Déplacement…">
              {startsAt ? <span className="first-letter:uppercase">Déplacer au {fmt.format(new Date(startsAt))}</span> : "Choisissez un créneau"}
            </SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setMode("none")}>
              Annuler
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
