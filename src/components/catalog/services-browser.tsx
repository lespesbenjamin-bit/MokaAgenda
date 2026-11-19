"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Home,
  Pencil,
  Plus,
  Power,
  Search,
  SlidersHorizontal,
  Sparkles,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ActionButton } from "@/components/ui/action-button";
import { serviceQuickAction } from "@/server/actions/catalog";
import {
  formatDuration,
  formatEuros,
  indicativeMargin,
  offeredPlaces,
  totalMobilizedMinutes,
  totalPriceCents,
  type Place,
  type ServicePricing,
} from "@/lib/domain/pricing";
import { cn } from "@/lib/utils";

export interface ServiceListItem {
  id: string;
  name: string;
  categoryId: string | null;
  durationMinutes: number;
  prepMinutes: number;
  cleanupMinutes: number;
  isActive: boolean;
  onlineBookable: boolean;
  archived: boolean;
  pricing: ServicePricing;
  costs: {
    consumablesCents: number;
    productsCents: number;
    otherCents: number;
  };
}

type StatusFilter = "current" | "active" | "inactive" | "archived";
type SortKey = "name" | "price" | "duration";

const PLACE_LABEL: Record<Place, string> = {
  salon: "Institut",
  home: "Domicile",
};

function depositLabel(p: ServicePricing): string {
  if (p.depositType === "fixed") return formatEuros(p.depositValue);
  if (p.depositType === "percentage") return `${p.depositValue} %`;
  return "Aucun";
}

function minPrice(s: ServiceListItem): number {
  const places = offeredPlaces(s.pricing);
  return places.length
    ? Math.min(...places.map((pl) => totalPriceCents(s.pricing, pl)))
    : s.pricing.basePriceCents;
}

export function ServicesBrowser({
  services,
  categories,
  canEdit,
}: {
  services: ServiceListItem[];
  categories: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("current");
  const [place, setPlace] = useState<"all" | Place>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [showFilters, setShowFilters] = useState(false);

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const filtered = useMemo(() => {
    const needle = q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const list = services.filter((s) => {
      if (status === "archived" ? !s.archived : s.archived) return false;
      if (status === "active" && !s.isActive) return false;
      if (status === "inactive" && s.isActive) return false;
      if (
        category === "none"
          ? s.categoryId !== null
          : category !== "all" && s.categoryId !== category
      )
        return false;
      if (place !== "all" && !offeredPlaces(s.pricing).includes(place))
        return false;
      if (needle) {
        const hay =
          `${s.name} ${s.categoryId ? (categoryName.get(s.categoryId) ?? "") : ""}`
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return list.sort((a, b) =>
      sort === "price"
        ? minPrice(a) - minPrice(b)
        : sort === "duration"
          ? a.durationMinutes - b.durationMinutes
          : a.name.localeCompare(b.name, "fr"),
    );
  }, [services, q, category, status, place, sort, categoryName]);

  if (services.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong bg-card px-6 py-14 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-primary">
          <Sparkles className="size-6" />
        </div>
        <div>
          <p className="font-display text-xl font-bold">
            Créez votre première prestation
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Durée, tarifs à domicile et en institut, acompte : tout se règle en
            une seule fiche.
          </p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link href="/prestations/nouvelle">
              <Plus /> Nouvelle prestation
            </Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1.6fr_repeat(4,1fr)]">
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="q">Rechercher</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom de la prestation"
              className="pl-10"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="lg:hidden"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls="service-filters"
        >
          <SlidersHorizontal />{" "}
          {showFilters ? "Masquer les filtres" : "Filtres et tri"}
        </Button>
        <div
          id="service-filters"
          className={cn(
            "gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4 lg:grid lg:grid-cols-4",
            showFilters ? "grid" : "hidden",
          )}
        >
          <FilterSelect
            id="f-cat"
            label="Catégorie"
            value={category}
            onChange={setCategory}
          >
            <option value="all">Toutes</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">Sans catégorie</option>
          </FilterSelect>
          <FilterSelect
            id="f-status"
            label="Statut"
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
          >
            <option value="current">Actives et inactives</option>
            <option value="active">Actives</option>
            <option value="inactive">Inactives</option>
            <option value="archived">Archivées</option>
          </FilterSelect>
          <FilterSelect
            id="f-place"
            label="Lieu"
            value={place}
            onChange={(v) => setPlace(v as "all" | Place)}
          >
            <option value="all">Domicile et institut</option>
            <option value="home">À domicile</option>
            <option value="salon">En institut</option>
          </FilterSelect>
          <FilterSelect
            id="f-sort"
            label="Trier par"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
          >
            <option value="name">Nom</option>
            <option value="price">Prix</option>
            <option value="duration">Durée</option>
          </FilterSelect>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {filtered.length} prestation{filtered.length > 1 ? "s" : ""}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Aucune prestation ne correspond à ces filtres.
        </p>
      ) : (
        <>
          {/* Ordinateur : tableau */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Prestation
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Durée
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Prix
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Acompte
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    <abbr
                      title="Marge contributive indicative avant déplacement"
                      className="no-underline"
                    >
                      Marge indic.
                    </abbr>
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Statut
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right font-semibold"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/prestations/${s.id}`}
                        className="font-semibold hover:text-primary"
                      >
                        {s.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {s.categoryId
                          ? (categoryName.get(s.categoryId) ?? "—")
                          : "Sans catégorie"}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {formatDuration(s.durationMinutes)}
                      {totalMobilizedMinutes(s) !== s.durationMinutes && (
                        <p className="text-xs text-muted-foreground">
                          {formatDuration(totalMobilizedMinutes(s))} mobilisées
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <PlacePrices s={s} />
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {depositLabel(s.pricing)}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <MarginCell s={s} />
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadges s={s} />
                    </td>
                    <td className="px-4 py-3.5">
                      <RowActions s={s} canEdit={canEdit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile et tablette : cartes */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {filtered.map((s) => (
              <li
                key={s.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/prestations/${s.id}`}
                      className="font-semibold hover:text-primary"
                    >
                      {s.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {s.categoryId
                        ? (categoryName.get(s.categoryId) ?? "—")
                        : "Sans catégorie"}{" "}
                      · {formatDuration(s.durationMinutes)}
                    </p>
                  </div>
                  <StatusBadges s={s} />
                </div>
                <div className="mt-3 flex items-end justify-between gap-3 text-sm">
                  <PlacePrices s={s} />
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">
                      Marge indic.
                    </p>
                    <MarginCell s={s} />
                  </div>
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <RowActions s={s} canEdit={canEdit} />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Marge indicative = prix HT − consommables et coûts directs,{" "}
            <strong>avant déplacement</strong>, cotisations et charges fixes. Ce
            n&apos;est pas un bénéfice net.
          </p>
        </>
      )}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </div>
  );
}

function PlacePrices({ s }: { s: ServiceListItem }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {offeredPlaces(s.pricing).map((pl) => (
        <li key={pl} className="flex items-center gap-1.5 whitespace-nowrap">
          {pl === "home" ? (
            <Home className="size-3.5 text-muted-foreground" />
          ) : (
            <Store className="size-3.5 text-muted-foreground" />
          )}
          <span className="sr-only">{PLACE_LABEL[pl]} :</span>
          <span className="font-medium">
            {formatEuros(totalPriceCents(s.pricing, pl))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MarginCell({ s }: { s: ServiceListItem }) {
  const pl = offeredPlaces(s.pricing)[0];
  if (!pl) return <span className="text-muted-foreground">—</span>;
  const m = indicativeMargin(s.pricing, s.costs, pl);
  return (
    <span
      className={cn(
        "font-semibold",
        m.contributionCents < 0 && "text-destructive",
      )}
      title={`Calculée sur le tarif ${PLACE_LABEL[pl].toLowerCase()}`}
    >
      {formatEuros(m.contributionCents)}
      {m.marginRatePct !== null && (
        <span className="ml-1 text-xs font-medium text-muted-foreground">
          ({m.marginRatePct.toLocaleString("fr-FR")} %)
        </span>
      )}
    </span>
  );
}

function StatusBadges({ s }: { s: ServiceListItem }) {
  if (s.archived) return <Badge variant="soon">Archivée</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {s.isActive ? (
        <Badge variant="available">Active</Badge>
      ) : (
        <Badge variant="soon">Inactive</Badge>
      )}
      {s.isActive && !s.onlineBookable && (
        <Badge variant="default">Hors ligne</Badge>
      )}
    </span>
  );
}

function RowActions({ s, canEdit }: { s: ServiceListItem; canEdit: boolean }) {
  if (!canEdit) {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href={`/prestations/${s.id}`}>Voir</Link>
      </Button>
    );
  }
  if (s.archived) {
    return (
      <div className="flex flex-wrap justify-end gap-1.5 lg:flex-nowrap">
        <ActionButton
          action={serviceQuickAction}
          fields={{ id: s.id, op: "restore" }}
        >
          <ArchiveRestore /> Restaurer
        </ActionButton>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5 lg:flex-nowrap">
      <Button asChild variant="outline" size="sm">
        <Link href={`/prestations/${s.id}`}>
          <Pencil /> Modifier
        </Link>
      </Button>
      <ActionButton
        action={serviceQuickAction}
        fields={{ id: s.id, op: "duplicate" }}
        ariaLabel={`Dupliquer ${s.name}`}
      >
        <Copy />
        <span className="sr-only">Dupliquer</span>
      </ActionButton>
      <ActionButton
        action={serviceQuickAction}
        fields={{ id: s.id, op: "toggle" }}
        ariaLabel={s.isActive ? `Désactiver ${s.name}` : `Activer ${s.name}`}
      >
        <Power />
        <span className="sr-only">{s.isActive ? "Désactiver" : "Activer"}</span>
      </ActionButton>
      <ActionButton
        action={serviceQuickAction}
        fields={{ id: s.id, op: "archive" }}
        ariaLabel={`Archiver ${s.name}`}
        confirm={{
          title: `Archiver « ${s.name} » ?`,
          description:
            "Elle ne sera plus proposée, mais son historique est conservé. Vous pourrez la restaurer depuis le filtre « Archivées ».",
          confirmLabel: "Archiver",
        }}
      >
        <Archive />
        <span className="sr-only">Archiver</span>
      </ActionButton>
    </div>
  );
}
