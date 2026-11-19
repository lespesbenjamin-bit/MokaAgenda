"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Mail,
  MapPin,
  Phone,
  Search,
  SlidersHorizontal,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  displayName,
  initials,
  normalizeName,
  normalizePhone,
} from "@/lib/domain/customers";

export interface CustomerListItem {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  archived: boolean;
  source: "manual" | "import" | "booking";
  created_at: string;
  updated_at: string;
}

type Status = "active" | "archived";
type Contact = "all" | "email" | "phone" | "none";
type Sort = "name" | "recent" | "updated";

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function CustomersBrowser({
  customers,
}: {
  customers: CustomerListItem[];
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [contact, setContact] = useState<Contact>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    const needle = normalizeName(q);
    const digits = q.replace(/\D/g, "");
    const list = customers.filter((c) => {
      if (status === "archived" ? !c.archived : c.archived) return false;
      if (contact === "email" && !c.email) return false;
      if (contact === "phone" && !c.phone) return false;
      if (contact === "none" && (c.email || c.phone)) return false;
      if (!q.trim()) return true;
      const name = normalizeName(`${c.first_name} ${c.last_name}`);
      const reversed = normalizeName(`${c.last_name} ${c.first_name}`);
      if (needle && (name.includes(needle) || reversed.includes(needle)))
        return true;
      if (c.email && c.email.toLowerCase().includes(q.trim().toLowerCase()))
        return true;
      if (
        digits.length >= 3 &&
        (normalizePhone(c.phone) ?? "").includes(
          normalizePhone(digits) ?? digits,
        )
      )
        return true;
      return false;
    });
    return list.sort((a, b) =>
      sort === "recent"
        ? b.created_at.localeCompare(a.created_at)
        : sort === "updated"
          ? b.updated_at.localeCompare(a.updated_at)
          : `${a.last_name} ${a.first_name}`.localeCompare(
              `${b.last_name} ${b.first_name}`,
              "fr",
              { sensitivity: "base" },
            ),
    );
  }, [customers, q, status, contact, sort]);

  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong bg-card px-6 py-14 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-primary">
          <Users className="size-6" />
        </div>
        <div>
          <p className="font-display text-xl font-bold">
            Votre fichier clientes est vide
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Ajoutez vos clientes une par une, ou importez votre fichier existant
            (CSV, export Excel).
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <Link href="/clientes/nouvelle">
              <UserPlus /> Ajouter une cliente
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/clientes/import">
              <Upload /> Importer un fichier
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-1.5 sm:col-span-3 lg:col-span-1">
          <Label htmlFor="cq">Rechercher</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="cq"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, email ou téléphone"
              className="pl-10"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="sm:hidden"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls="customer-filters"
        >
          <SlidersHorizontal />{" "}
          {showFilters ? "Masquer les filtres" : "Filtres et tri"}
        </Button>
        <div
          id="customer-filters"
          className={cn(
            "gap-3 sm:col-span-3 sm:grid sm:grid-cols-3 lg:col-span-3",
            showFilters ? "grid" : "hidden",
          )}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cs">Statut</Label>
            <Select
              id="cs"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              <option value="active">Actives</option>
              <option value="archived">Archivées</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cc">Coordonnées</Label>
            <Select
              id="cc"
              value={contact}
              onChange={(e) => setContact(e.target.value as Contact)}
            >
              <option value="all">Toutes</option>
              <option value="email">Avec email</option>
              <option value="phone">Avec téléphone</option>
              <option value="none">Sans coordonnées</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct">Trier par</Label>
            <Select
              id="ct"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="name">Nom</option>
              <option value="recent">Plus récentes</option>
              <option value="updated">Dernière modification</option>
            </Select>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {filtered.length} cliente{filtered.length > 1 ? "s" : ""}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Aucune cliente ne correspond à cette recherche.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Cliente
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Téléphone
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Ville
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Créée le
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-surface">
                    <td className="px-4 py-3">
                      <Link
                        href={`/clientes/${c.id}`}
                        className="flex items-center gap-3 font-semibold hover:text-primary"
                      >
                        <Avatar c={c} />
                        {displayName(c)}
                        {c.source === "import" && (
                          <Badge variant="soon">Importée</Badge>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {c.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.city ?? "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {dateFmt.format(new Date(c.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clientes/${c.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 active:bg-surface"
                >
                  <Avatar c={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {displayName(c)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {c.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="size-3" /> {c.phone}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex min-w-0 items-center gap-1 truncate">
                          <Mail className="size-3" /> {c.email}
                        </span>
                      )}
                      {c.city && (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3" /> {c.city}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Avatar({ c }: { c: CustomerListItem }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
      {initials(c)}
    </span>
  );
}
