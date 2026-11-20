"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { listIdentities } from "@/server/repositories/customers";
import { RepositoryError } from "@/server/repositories/business";
import { importKey } from "@/lib/domain/customers";
import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  analyzeImport,
  mapRows,
  summarize,
  type AnalyzedRow,
  type ColumnMapping,
  type ImportRowStatus,
} from "@/lib/domain/csv-import";

export interface ImportPayload {
  rows: string[][];
  mapping: ColumnMapping;
  hasHeader: boolean;
}

export interface AnalyzedRowView {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: ImportRowStatus;
  detail: string | null;
}

export interface AnalysisResult {
  ok: boolean;
  error?: string;
  summary?: Record<ImportRowStatus, number>;
  rows?: AnalyzedRowView[];
}

export interface ImportReport {
  ok: boolean;
  error?: string;
  created?: number;
  summary?: Record<ImportRowStatus, number>;
  failedLines?: number[];
}

function validatePayload(p: ImportPayload): string | null {
  if (!p || !Array.isArray(p.rows)) return "Fichier illisible.";
  if (p.rows.length === 0) return "Le fichier est vide.";
  if (p.rows.length > MAX_IMPORT_ROWS + 1) return `Le fichier dépasse ${MAX_IMPORT_ROWS} lignes. Découpez-le en plusieurs fichiers.`;
  if (p.rows.some((r) => !Array.isArray(r) || r.length > 60 || r.some((c) => typeof c !== "string" || c.length > 5000))) return "Format de fichier non pris en charge.";
  const fields = Object.keys(p.mapping ?? {});
  if (fields.some((f) => !(f in IMPORT_FIELDS))) return "Correspondance des colonnes invalide.";
  if (!fields.some((f) => ["firstName", "lastName", "fullName"].includes(f))) return "Associez au moins une colonne au prénom, au nom ou au nom complet.";
  return null;
}

async function analyze(p: ImportPayload): Promise<{ analyzed: AnalyzedRow[]; businessId: string; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }> {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const candidates = mapRows(p.rows, p.mapping, { hasHeader: p.hasHeader });
  const keyed = await Promise.all(candidates.map(async (c) => ({ candidate: c, key: await importKey(c) })));
  const existing = await listIdentities(supabase, ctx.business.id);
  const keys = new Set(existing.map((e) => e.import_key).filter((k): k is string => Boolean(k)));
  return { analyzed: analyzeImport(keyed, existing, keys), businessId: ctx.business.id, supabase };
}

function toView(r: AnalyzedRow): AnalyzedRowView {
  const c = r.candidate;
  return {
    line: c.line,
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "—",
    email: c.email,
    phone: c.phone,
    city: c.address?.city ?? null,
    status: r.status,
    detail: r.status === "invalid" ? c.errors.join(" · ") : r.matches.length ? `Ressemble à : ${r.matches.map((m) => m.name).join(", ")}` : null,
  };
}

/** Étapes 4 et 5 : vérification des données et détection des doublons (aucune écriture). */
export async function analyzeImportAction(payload: ImportPayload): Promise<AnalysisResult> {
  const invalid = validatePayload(payload);
  if (invalid) return { ok: false, error: invalid };
  try {
    const { analyzed } = await analyze(payload);
    return { ok: true, summary: summarize(analyzed), rows: analyzed.map(toView) };
  } catch (error) {
    console.error("[import] analyse", error);
    return { ok: false, error: "L'analyse du fichier a échoué. Réessayez." };
  }
}

/**
 * Étapes 6 et 7 : confirmation puis rapport. L'analyse est refaite côté serveur ;
 * seules les lignes « À importer » sont créées. Aucune fiche existante n'est modifiée.
 * Relancer le même import ne crée pas de doublon (clé d'import unique).
 */
export async function commitImportAction(payload: ImportPayload): Promise<ImportReport> {
  const invalid = validatePayload(payload);
  if (invalid) return { ok: false, error: invalid };
  try {
    const { analyzed, businessId, supabase } = await analyze(payload);
    const toCreate = analyzed.filter((r) => r.status === "new");
    let created = 0;
    const failedLines: number[] = [];

    for (let i = 0; i < toCreate.length; i += 200) {
      const batch = toCreate.slice(i, i + 200);
      const { data, error } = await supabase
        .from("customers")
        .insert(
          batch.map(({ candidate: c, key }) => ({
            business_id: businessId,
            first_name: c.first_name,
            last_name: c.last_name,
            email: c.email,
            phone: c.phone,
            birth_date: c.birth_date,
            notes: c.notes,
            source: "import",
            import_key: key,
          })),
        )
        .select("id, import_key");
      if (error) {
        // Lot refusé (ex. import concurrent) : on réessaie ligne par ligne pour ne rien perdre
        for (const row of batch) {
          const single = await supabase
            .from("customers")
            .insert({
              business_id: businessId,
              first_name: row.candidate.first_name,
              last_name: row.candidate.last_name,
              email: row.candidate.email,
              phone: row.candidate.phone,
              birth_date: row.candidate.birth_date,
              notes: row.candidate.notes,
              source: "import",
              import_key: row.key,
            })
            .select("id, import_key")
            .single();
          if (single.error) failedLines.push(row.candidate.line);
          else {
            created++;
            await addAddress(supabase, businessId, single.data.id, row);
          }
        }
        continue;
      }
      created += data.length;
      const idByKey = new Map(data.map((d) => [d.import_key as string, d.id as string]));
      const addresses = batch
        .filter((r) => r.candidate.address && idByKey.has(r.key))
        .map((r) => ({
          business_id: businessId,
          customer_id: idByKey.get(r.key)!,
          kind: "home",
          line1: r.candidate.address!.line1,
          postal_code: r.candidate.address!.postalCode,
          city: r.candidate.address!.city,
          is_primary: true,
        }));
      if (addresses.length) {
        const res = await supabase.from("customer_addresses").insert(addresses);
        if (res.error) throw new RepositoryError("Import des adresses", res.error);
      }
    }

    revalidatePath("/clientes");
    return { ok: true, created, summary: summarize(analyzed), failedLines };
  } catch (error) {
    console.error("[import] confirmation", error);
    return { ok: false, error: "L'import a été interrompu. Les fiches déjà créées sont conservées ; relancez l'import : elles ne seront pas recréées." };
  }
}

async function addAddress(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, businessId: string, customerId: string, row: AnalyzedRow) {
  const a = row.candidate.address;
  if (!a) return;
  await supabase
    .from("customer_addresses")
    .insert({ business_id: businessId, customer_id: customerId, kind: "home", line1: a.line1, postal_code: a.postalCode, city: a.city, is_primary: true });
}
