import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import type { NavItem } from "@/config/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

/**
 * État explicite pour un module non développé.
 * Ne simule aucune donnée ni action : affiche seulement la feuille de route.
 */
export function ComingSoon({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <>
      <PageHeader
        eyebrow={
          <Badge variant="soon" className="w-fit">
            <Clock className="size-3" /> À venir
          </Badge>
        }
        title={item.label}
        description={item.summary}
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center gap-4 bg-secondary/60 px-6 py-12 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-card shadow-sm">
            <Icon className="size-7 text-primary" />
          </div>
          <div className="max-w-md">
            <p className="font-display text-xl font-bold">Ce module n&apos;est pas encore disponible</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Il sera livré dans un prochain sprint. Aucune donnée n&apos;est enregistrée ici pour le moment.
            </p>
          </div>
        </div>
        {item.planned.length > 0 && (
          <>
            <CardHeader>
              <CardTitle>Ce qui est prévu</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                {item.planned.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
          </>
        )}
      </Card>
      <Button asChild variant="ghost" className="mt-6">
        <Link href="/tableau-de-bord">
          <ArrowLeft /> Retour au tableau de bord
        </Link>
      </Button>
    </>
  );
}
