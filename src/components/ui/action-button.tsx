"use client";

import { useActionState, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import type { FormState } from "@/lib/validation/auth";

interface ActionButtonProps extends Pick<ButtonProps, "variant" | "size" | "className"> {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  children: ReactNode;
  /** Si défini, une confirmation est demandée avant l'envoi. */
  confirm?: { title: string; description: string; confirmLabel: string };
  ariaLabel?: string;
}

/**
 * Bouton qui déclenche une Server Action, avec confirmation facultative
 * (fenêtre accessible, Échap pour annuler) et message d'erreur en cas d'échec.
 */
export function ActionButton({ action, fields, children, confirm, variant = "outline", size = "sm", className, ariaLabel }: ActionButtonProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <form ref={formRef} action={formAction} className="inline-flex">
        {Object.entries(fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Button
          type={confirm ? "button" : "submit"}
          variant={variant}
          size={size}
          className={className}
          disabled={pending}
          aria-label={ariaLabel}
          title={ariaLabel}
          onClick={confirm ? () => dialogRef.current?.showModal() : undefined}
        >
          {pending ? <Loader2 className="animate-spin" /> : children}
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="mt-1 text-xs font-medium text-destructive">
          {state.error}
        </p>
      )}
      {confirm && (
        <dialog
          ref={dialogRef}
          className="m-auto w-[min(92vw,420px)] rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-ink/40"
          aria-labelledby="confirm-title"
        >
          <h2 id="confirm-title" className="font-display text-lg font-bold">
            {confirm.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{confirm.description}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()}>
              Annuler
            </Button>
            <Button
              type="button"
              onClick={() => {
                dialogRef.current?.close();
                formRef.current?.requestSubmit();
              }}
            >
              {confirm.confirmLabel}
            </Button>
          </div>
        </dialog>
      )}
    </>
  );
}
