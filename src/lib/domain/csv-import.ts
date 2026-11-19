/**
 * Import CSV de clientes : lecture du fichier, correspondance des colonnes,
 * vérification et classement des lignes. Fonctions pures, testées.
 * L'analyse est TOUJOURS refaite côté serveur avant insertion.
 */
import { z } from "zod";
import { findDuplicates, normalizeEmail, normalizePhone, type CustomerIdentity, type DuplicateMatch } from "./customers";

export const MAX_IMPORT_ROWS = 2000;

/** Lecture CSV (RFC 4180) : guillemets, retours à la ligne, séparateur , ; ou tabulation détecté. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

export const IMPORT_FIELDS = {
  firstName: "Prénom",
  lastName: "Nom",
  fullName: "Nom complet",
  email: "Email",
  phone: "Téléphone",
  birthDate: "Date de naissance",
  addressLine1: "Adresse",
  postalCode: "Code postal",
  city: "Ville",
  notes: "Notes",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
export type ColumnMapping = Partial<Record<ImportField, number>>;

const HEADER_HINTS: Record<ImportField, string[]> = {
  firstName: ["prenom", "first name", "firstname", "given name"],
  lastName: ["nom de famille", "nom", "last name", "lastname", "surname", "family name"],
  fullName: ["nom complet", "full name", "name", "client", "cliente"],
  email: ["email", "e mail", "mail", "courriel", "adresse email"],
  phone: ["telephone", "tel", "portable", "mobile", "phone", "gsm"],
  birthDate: ["date de naissance", "naissance", "birthday", "birth date", "date naissance", "anniversaire"],
  addressLine1: ["adresse", "address", "rue", "street"],
  postalCode: ["code postal", "cp", "postal code", "zip"],
  city: ["ville", "city", "commune"],
  notes: ["notes", "note", "commentaire", "commentaires", "remarques"],
};

const simplify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Propose une correspondance des colonnes à partir des en-têtes (modifiable par l'utilisatrice). */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const simplified = headers.map(simplify);
  // Ordre important : les champs les plus spécifiques d'abord
  const order: ImportField[] = ["firstName", "birthDate", "postalCode", "email", "phone", "city", "notes", "lastName", "addressLine1", "fullName"];
  for (const field of order) {
    for (const hint of HEADER_HINTS[field]) {
      const idx = simplified.findIndex((h, i) => !used.has(i) && h === hint);
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  if (mapping.firstName !== undefined || mapping.lastName !== undefined) delete mapping.fullName;
  return mapping;
}

/** "12/03/1990", "12-03-1990", "1990-03-12" → "1990-03-12" ; null si vide ; undefined si invalide. */
export function parseBirthDate(value: string | undefined, today = new Date()): string | null | undefined {
  const v = (value ?? "").trim();
  if (!v) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (match) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  if (y < 1900 || date > today) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface ImportCandidate extends CustomerIdentity {
  line: number;
  notes: string | null;
  address: { line1: string; postalCode: string | null; city: string } | null;
  errors: string[];
}

const emailSchema = z.email();

/** Transforme les lignes du fichier en fiches candidates, avec erreurs de saisie. */
export function mapRows(rows: string[][], mapping: ColumnMapping, { hasHeader = true } = {}): ImportCandidate[] {
  const body = hasHeader ? rows.slice(1) : rows;
  return body.slice(0, MAX_IMPORT_ROWS).map((cells, i) => {
    const get = (f: ImportField) => {
      const idx = mapping[f];
      return idx === undefined ? "" : (cells[idx] ?? "").trim();
    };
    const errors: string[] = [];
    let first = get("firstName");
    let last = get("lastName");
    if (!first && !last && get("fullName")) {
      const parts = get("fullName").split(/\s+/);
      first = parts.shift() ?? "";
      last = parts.join(" ");
    }
    if (!first && !last) errors.push("Nom manquant");
    if (first.length > 80 || last.length > 80) errors.push("Nom trop long");

    const rawEmail = get("email");
    const email = rawEmail ? rawEmail.toLowerCase() : null;
    if (email && !emailSchema.safeParse(email).success) errors.push("Email invalide");

    const rawPhone = get("phone");
    const phone = rawPhone || null;
    if (phone && !/^\+?[0-9 .()-]{6,30}$/.test(phone)) errors.push("Téléphone invalide");

    const birth = parseBirthDate(get("birthDate"));
    if (birth === undefined) errors.push("Date de naissance invalide");

    const line1 = get("addressLine1");
    const city = get("city");
    let address: ImportCandidate["address"] = null;
    if (line1 || city) {
      if (line1 && city) address = { line1: line1.slice(0, 200), postalCode: get("postalCode") || null, city: city.slice(0, 100) };
      else errors.push("Adresse incomplète (adresse et ville requises)");
    }

    return {
      line: i + (hasHeader ? 2 : 1),
      first_name: first,
      last_name: last,
      email,
      phone,
      birth_date: birth ?? null,
      notes: get("notes").slice(0, 5000) || null,
      address,
      errors,
    };
  });
}

export type ImportRowStatus = "new" | "invalid" | "duplicate_existing" | "duplicate_in_file" | "already_imported";

export const IMPORT_STATUS_LABELS: Record<ImportRowStatus, string> = {
  new: "À importer",
  invalid: "Erreur",
  duplicate_existing: "Doublon d'une fiche existante",
  duplicate_in_file: "Doublon dans le fichier",
  already_imported: "Déjà importée",
};

export interface AnalyzedRow {
  candidate: ImportCandidate;
  key: string;
  status: ImportRowStatus;
  matches: DuplicateMatch[];
}

/**
 * Classe chaque ligne. Une fiche existante n'est JAMAIS modifiée :
 * les doublons et lignes déjà importées sont simplement ignorés et signalés.
 */
export function analyzeImport(
  candidates: { candidate: ImportCandidate; key: string }[],
  existing: (CustomerIdentity & { id: string })[],
  existingImportKeys: Set<string>,
): AnalyzedRow[] {
  const seenKeys = new Set<string>();
  const accepted: (CustomerIdentity & { id: string })[] = [];
  return candidates.map(({ candidate, key }) => {
    if (candidate.errors.length) return { candidate, key, status: "invalid", matches: [] };
    if (existingImportKeys.has(key)) return { candidate, key, status: "already_imported", matches: [] };
    const matches = findDuplicates(candidate, existing);
    if (matches.length) return { candidate, key, status: "duplicate_existing", matches };
    const inFile = findDuplicates(candidate, accepted);
    if (seenKeys.has(key) || inFile.length) {
      return { candidate, key, status: "duplicate_in_file", matches: inFile };
    }
    seenKeys.add(key);
    accepted.push({ ...candidate, id: `ligne-${candidate.line}` });
    return { candidate, key, status: "new", matches: [] };
  });
}

export function summarize(rows: AnalyzedRow[]): Record<ImportRowStatus, number> {
  const out: Record<ImportRowStatus, number> = { new: 0, invalid: 0, duplicate_existing: 0, duplicate_in_file: 0, already_imported: 0 };
  for (const r of rows) out[r.status]++;
  return out;
}

export { normalizeEmail, normalizePhone };
