"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { abandonPaymentAction, resumePaymentAction, type BookingState } from "@/server/actions/public-booking";

/** Rafraîchit la page le temps que Stripe confirme le paiement (webhook) — jamais de confirmation par le navigateur. */
export function AwaitConfirmation({ max = 20 }: { max?: number }) {
  const router = useRouter();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= max) return;
    const t = setTimeout(() => {
      router.refresh();
      setN((x) => x + 1);
    }, 3000);
    return () => clearTimeout(t);
  }, [n, max, router]);
  return n >= max ? (
    <FormAlert type="info">La confirmation prend plus de temps que prévu. Vous recevrez un email dès qu&apos;elle sera enregistrée : inutile de payer à nouveau.</FormAlert>
  ) : (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Confirmation du paiement par Stripe en cours…
    </p>
  );
}

export function PaymentChoices({ slug, holdId }: { slug: string; holdId: string }) {
  const [resume, resumeAction, resuming] = useActionState<BookingState, FormData>(resumePaymentAction.bind(null, slug, holdId), {});
  const [abandon, abandonAction, abandoning] = useActionState<BookingState, FormData>(abandonPaymentAction.bind(null, slug, holdId), {});
  const error = resume.error ?? abandon.error;
  return (
    <div className="flex flex-col gap-3">
      {error && <FormAlert type="error">{error}</FormAlert>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={resumeAction}>
          <Button type="submit" disabled={resuming || abandoning} className="w-full sm:w-auto">
            {resuming && <Loader2 className="animate-spin" />} Reprendre le paiement
          </Button>
        </form>
        <form action={abandonAction}>
          <Button type="submit" variant="outline" disabled={resuming || abandoning} className="w-full sm:w-auto">
            {abandoning && <Loader2 className="animate-spin" />} Annuler cette réservation
          </Button>
        </form>
      </div>
    </div>
  );
}
