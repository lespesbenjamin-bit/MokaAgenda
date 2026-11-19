"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-14 text-center">
      <AlertTriangle className="size-8 text-primary" />
      <div>
        <h1 className="font-display text-xl font-bold">Le chargement a échoué</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vos données n&apos;ont pas pu être récupérées. Vérifiez votre connexion puis réessayez.
        </p>
        {error.digest && <p className="mt-2 text-xs text-muted-foreground">Référence : {error.digest}</p>}
      </div>
      <Button onClick={reset}>
        <RotateCcw /> Réessayer
      </Button>
    </div>
  );
}
