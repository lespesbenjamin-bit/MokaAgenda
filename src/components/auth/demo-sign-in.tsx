"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { demoSignInAction } from "@/server/actions/auth";
import { FormAlert } from "@/components/ui/form-alert";
import { SubmitButton } from "@/components/ui/submit-button";

export function DemoSignIn() {
  const [state, action] = useActionState(demoSignInAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error && <FormAlert type="error">{state.error}</FormAlert>}
      <SubmitButton variant="secondary" size="lg" pendingLabel="Ouverture de la démo…">
        <Sparkles /> Explorer la démo sans compte
      </SubmitButton>
    </form>
  );
}
