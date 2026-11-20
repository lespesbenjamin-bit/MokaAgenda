"use client";

import { useActionState, useRef } from "react";
import { Ban, CheckCircle2, CircleCheckBig, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionButton } from "@/components/ui/action-button";
import { changeStatusAction } from "@/server/actions/agenda";
import type { AppointmentStatus } from "@/lib/domain/appointments";

const LABELS: Partial<Record<AppointmentStatus, { label: string; icon: typeof Ban }>> = {
  confirmed: { label: "Confirmer", icon: CheckCircle2 },
  completed: { label: "Marquer terminé", icon: CircleCheckBig },
  no_show: { label: "Cliente absente", icon: UserX },
};

/** Boutons des changements de statut autorisés ; l'annulation demande une confirmation et un motif. */
export function StatusActions({ id, allowed }: { id: string; allowed: AppointmentStatus[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(changeStatusAction, {});
  if (allowed.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {allowed
          .filter((s) => s !== "cancelled")
          .map((s) => {
            const { label, icon: Icon } = LABELS[s]!;
            return (
              <ActionButton
                key={s}
                action={changeStatusAction}
                fields={{ id, status: s }}
                size="default"
                variant={s === "confirmed" || s === "completed" ? "default" : "outline"}
                confirm={s === "no_show" ? { title: "Marquer la cliente absente ?", description: "Le rendez-vous sera clôturé.", confirmLabel: "Confirmer" } : undefined}
              >
                <Icon /> {label}
              </ActionButton>
            );
          })}
        {allowed.includes("cancelled") && (
          <Button variant="outline" onClick={() => dialogRef.current?.showModal()}>
            <Ban /> Annuler le rendez-vous
          </Button>
        )}
      </div>
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <dialog ref={dialogRef} className="m-auto w-[min(92vw,440px)] rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-ink/40" aria-labelledby="cancel-title">
        <form action={action} className="flex flex-col gap-4" onSubmit={() => dialogRef.current?.close()}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value="cancelled" />
          <h2 id="cancel-title" className="font-display text-lg font-bold">
            Annuler ce rendez-vous ?
          </h2>
          <p className="text-sm text-muted-foreground">Le créneau sera libéré. Le rendez-vous reste visible dans l&apos;historique.</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancel_reason">Motif (facultatif)</Label>
            <Textarea id="cancel_reason" name="cancel_reason" maxLength={500} className="min-h-16" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              Retour
            </Button>
            <SubmitButton pendingLabel="Annulation…">Annuler le rendez-vous</SubmitButton>
          </div>
        </form>
      </dialog>
    </div>
  );
}
