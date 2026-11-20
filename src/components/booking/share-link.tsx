"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copier / partager le lien de la page de réservation (Instagram, WhatsApp, Google, site). */
export function ShareLink({ url, title, compact = false }: { url: string; title: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copiez le lien :", url);
    }
  }

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* partage annulé */
      }
    }
    await copy();
  }

  if (compact) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={share}>
        {copied ? <Check /> : <Share2 />} {copied ? "Lien copié" : "Partager"}
      </Button>
    );
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${title} — réservez en ligne : ${url}`)}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-sm">{url}</code>
        <Button type="button" size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? "Copié" : "Copier"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={share}>
          <Share2 /> Partager
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noopener noreferrer">Voir ma page</a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Collez ce lien dans votre bio Instagram, votre fiche Google (champ « Lien de réservation ») ou sur votre site Moka Studio.
      </p>
    </div>
  );
}
