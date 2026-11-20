"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox, Label, Select } from "@/components/ui/input";
import { analyzeImportAction, commitImportAction, type AnalysisResult, type ImportReport } from "@/server/actions/customer-import";
import { IMPORT_FIELDS, IMPORT_STATUS_LABELS, MAX_IMPORT_ROWS, guessMapping, parseCsv, type ColumnMapping, type ImportField, type ImportRowStatus } from "@/lib/domain/csv-import";
import { cn } from "@/lib/utils";

const STEPS = ["Fichier", "Aperçu", "Colonnes", "Vérification et doublons", "Confirmation", "Rapport"] as const;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const STATUS_VARIANT: Record<ImportRowStatus, "available" | "warning" | "soon" | "default"> = {
  new: "available",
  invalid: "warning",
  duplicate_existing: "default",
  duplicate_in_file: "default",
  already_imported: "soon",
};

export function ImportWizard() {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ImportRowStatus | "all">("all");
  const [pending, startTransition] = useTransition();

  const headers = useMemo(() => (rows[0] ?? []).map((h, i) => (hasHeader ? h || `Colonne ${i + 1}` : `Colonne ${i + 1}`)), [rows, hasHeader]);
  const dataRows = hasHeader ? rows.length - 1 : rows.length;

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setError("Le fichier dépasse 2 Mo. Découpez-le en plusieurs fichiers.");
    if (!/\.(csv|txt)$/i.test(file.name) && !file.type.includes("csv") && !file.type.startsWith("text/")) {
      return setError("Choisissez un fichier CSV. Depuis Excel : Fichier › Enregistrer sous › « CSV UTF-8 ».");
    }
    let text = await file.text();
    if (text.includes("�")) {
      // Fichier enregistré en Windows-1252 (ancien Excel) : on le relit dans cet encodage
      text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
    }
    const parsed = parseCsv(text);
    if (parsed.length < 2) return setError("Le fichier ne contient pas de données.");
    if (parsed.length > MAX_IMPORT_ROWS + 1) return setError(`Le fichier contient plus de ${MAX_IMPORT_ROWS} lignes. Découpez-le en plusieurs fichiers.`);
    setFileName(file.name);
    setRows(parsed);
    setMapping(guessMapping(parsed[0]));
    setStep(1);
  }

  function setField(field: ImportField, value: string) {
    setMapping((m) => {
      const next = { ...m };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  function verify() {
    setError(null);
    startTransition(async () => {
      const r = await analyzeImportAction({ rows, mapping, hasHeader });
      if (!r.ok) return setError(r.error ?? "Analyse impossible.");
      setAnalysis(r);
      setFilter("all");
      setStep(3);
    });
  }

  function confirmImport() {
    setError(null);
    startTransition(async () => {
      const r = await commitImportAction({ rows, mapping, hasHeader });
      if (!r.ok) return setError(r.error ?? "Import impossible.");
      setReport(r);
      setStep(5);
    });
  }

  const toImport = analysis?.summary?.new ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2" aria-label="Étapes de l'import">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold",
              i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground",
            )}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {error && <FormAlert type="error">{error}</FormAlert>}

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        {step === 0 && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <FileUp className="size-8 text-primary" />
            <div>
              <p className="font-display text-xl font-bold">Choisissez votre fichier clientes</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Format CSV (export Excel, Google Sheets ou ancien logiciel). Jusqu&apos;à {MAX_IMPORT_ROWS} clientes, 2 Mo maximum. Aucune fiche existante ne sera modifiée.
              </p>
            </div>
            <label className="cursor-pointer">
              <span className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover has-[:focus-visible]:ring-3">
                <FileUp className="size-4" /> Choisir un fichier
              </span>
              <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              <strong>{fileName}</strong> — {dataRows} ligne{dataRows > 1 ? "s" : ""} de données. Voici les premières :
            </p>
            <Checkbox checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} label="La première ligne contient les titres des colonnes" />
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 6).map((r, i) => (
                    <tr key={i} className={cn(i === 0 && hasHeader && "bg-surface font-semibold")}>
                      {r.map((c, j) => (
                        <td key={j} className="max-w-48 truncate px-3 py-2">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextLabel="Associer les colonnes" />
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Indiquez quelle colonne de votre fichier correspond à chaque information. Nous avons fait une proposition.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {(Object.keys(IMPORT_FIELDS) as ImportField[]).map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <Label htmlFor={`map-${field}`}>{IMPORT_FIELDS[field]}</Label>
                  <Select id={`map-${field}`} value={mapping[field] ?? ""} onChange={(e) => setField(field, e.target.value)}>
                    <option value="">— Ne pas importer —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">« Nom complet » sert uniquement si votre fichier n&apos;a pas de colonnes Prénom et Nom séparées.</p>
            <Nav onBack={() => setStep(1)} onNext={verify} nextLabel="Vérifier les données" pending={pending} />
          </div>
        )}

        {step === 3 && analysis?.rows && analysis.summary && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(Object.keys(IMPORT_STATUS_LABELS) as ImportRowStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilter(filter === s ? "all" : s)}
                  aria-pressed={filter === s}
                  className={cn("rounded-xl border p-3 text-left transition-colors", filter === s ? "border-primary bg-accent" : "border-border hover:bg-surface")}
                >
                  <p className="text-2xl font-bold">{analysis.summary![s]}</p>
                  <p className="text-xs text-muted-foreground">{IMPORT_STATUS_LABELS[s]}</p>
                </button>
              ))}
            </div>
            <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">Ligne</th>
                    <th scope="col" className="px-3 py-2">Cliente</th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">Contact</th>
                    <th scope="col" className="px-3 py-2">Résultat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {analysis.rows
                    .filter((r) => filter === "all" || r.status === filter)
                    .map((r) => (
                      <tr key={r.line} className="align-top">
                        <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{[r.email, r.phone].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_VARIANT[r.status]}>{IMPORT_STATUS_LABELS[r.status]}</Badge>
                          {r.detail && <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <Nav onBack={() => setStep(2)} onNext={() => setStep(4)} nextLabel="Continuer" disabled={toImport === 0} />
            {toImport === 0 && <p className="text-sm text-muted-foreground">Aucune nouvelle cliente à importer.</p>}
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            <p className="font-display text-xl font-bold">
              Importer {toImport} nouvelle{toImport > 1 ? "s" : ""} cliente{toImport > 1 ? "s" : ""} ?
            </p>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              <li>Les lignes en erreur, les doublons et les lignes déjà importées seront ignorés.</li>
              <li>Aucune fiche existante ne sera modifiée.</li>
              <li>Si vous relancez ce même fichier plus tard, les clientes déjà importées ne seront pas recréées.</li>
            </ul>
            <Nav onBack={() => setStep(3)} onNext={confirmImport} nextLabel="Lancer l'import" pending={pending} />
          </div>
        )}

        {step === 5 && report && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <p className="font-display text-2xl font-bold">
              {report.created} cliente{(report.created ?? 0) > 1 ? "s" : ""} importée{(report.created ?? 0) > 1 ? "s" : ""}
            </p>
            {report.summary && (
              <p className="text-sm text-muted-foreground">
                Ignorées : {report.summary.invalid} en erreur · {report.summary.duplicate_existing} déjà dans votre fichier · {report.summary.duplicate_in_file} en double ·{" "}
                {report.summary.already_imported} déjà importées
              </p>
            )}
            {report.failedLines && report.failedLines.length > 0 && (
              <FormAlert type="error">Lignes non importées suite à une erreur : {report.failedLines.join(", ")}. Vous pouvez relancer l&apos;import.</FormAlert>
            )}
            <Button asChild>
              <Link href="/clientes">Voir mes clientes</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Nav({
  onBack,
  onNext,
  nextLabel,
  pending,
  disabled,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
      <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
        <ArrowLeft /> Retour
      </Button>
      <Button type="button" size="lg" onClick={onNext} disabled={pending || disabled} aria-busy={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null} {nextLabel} {!pending && <ArrowRight />}
      </Button>
    </div>
  );
}
