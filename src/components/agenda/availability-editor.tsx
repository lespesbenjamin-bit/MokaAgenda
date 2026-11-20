"use client";

import { useActionState, useState, useTransition } from "react";
import { CalendarOff, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox, Input, Label, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionButton } from "@/components/ui/action-button";
import { addExceptionAction, deleteExceptionAction, saveRulesAction } from "@/server/actions/agenda";
import { EXCEPTION_KIND_LABELS, WEEKDAY_LABELS } from "@/lib/domain/appointments";
import type { AvailabilityRule } from "@/lib/domain/availability";
import { hhmmToMinute, minuteToHHMM } from "@/lib/domain/time";
import type { Place } from "@/lib/domain/pricing";

interface Range {
  key: number;
  start: string;
  end: string;
  place: "" | Place;
}

let seq = 0;
const nextKey = () => ++seq;

export function WeeklyHoursEditor({ initial, hybrid, canEdit }: { initial: AvailabilityRule[]; hybrid: boolean; canEdit: boolean }) {
  const [days, setDays] = useState<Range[][]>(() =>
    Array.from({ length: 7 }, (_, i) =>
      initial
        .filter((r) => r.weekday === i + 1)
        .sort((a, b) => a.startMinute - b.startMinute)
        .map((r) => ({ key: nextKey(), start: minuteToHHMM(r.startMinute), end: minuteToHHMM(r.endMinute), place: r.place ?? "" })),
    ),
  );
  const [result, setResult] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (day: number, fn: (ranges: Range[]) => Range[]) => setDays((d) => d.map((r, i) => (i === day ? fn(r) : r)));

  function addRange(day: number) {
    update(day, (r) => {
      const last = r[r.length - 1];
      const startMin = last ? (hhmmToMinute(last.end) ?? 720) + 60 : 540;
      return [...r, { key: nextKey(), start: minuteToHHMM(Math.min(startMin, 1380)), end: minuteToHHMM(Math.min(startMin + 180, 1440)), place: "" }];
    });
  }

  function copyToWeekdays(day: number) {
    setDays((d) => d.map((r, i) => (i < 5 && i !== day ? d[day].map((x) => ({ ...x, key: nextKey() })) : r)));
  }

  function save() {
    setResult(null);
    const rules: AvailabilityRule[] = [];
    for (let i = 0; i < 7; i++) {
      for (const r of days[i]) {
        const s = hhmmToMinute(r.start);
        const e = hhmmToMinute(r.end);
        if (s === null || e === null || e <= s) {
          setResult({ type: "error", text: `${WEEKDAY_LABELS[i]} : l'heure de fin doit être après l'heure de début.` });
          return;
        }
        rules.push({ weekday: i + 1, startMinute: s, endMinute: e, place: r.place || null });
      }
      const sorted = rules.filter((r) => r.weekday === i + 1).sort((a, b) => a.startMinute - b.startMinute);
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k].startMinute < sorted[k - 1].endMinute) {
          setResult({ type: "error", text: `${WEEKDAY_LABELS[i]} : deux plages se chevauchent.` });
          return;
        }
      }
    }
    startTransition(async () => {
      const r = await saveRulesAction(rules);
      setResult(r.error ? { type: "error", text: r.error } : { type: "success", text: r.success ?? "Enregistré." });
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="hours-title">
      <div>
        <h2 id="hours-title" className="font-display text-lg font-bold">
          Horaires de la semaine
        </h2>
        <p className="text-sm text-muted-foreground">
          Ajoutez plusieurs plages par jour : l&apos;intervalle entre deux plages est une pause.
          {hybrid && " Pour chaque plage, indiquez si elle est réservée au domicile, à l'institut, ou aux deux."}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {WEEKDAY_LABELS.map((label, day) => (
          <li key={label} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
            <p className="w-28 shrink-0 pt-2 font-semibold">{label}</p>
            <div className="flex flex-1 flex-col gap-2">
              {days[day].length === 0 && <p className="pt-2 text-sm text-muted-foreground">Fermé</p>}
              {days[day].map((r) => (
                <div key={r.key} className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    step={900}
                    value={r.start}
                    disabled={!canEdit}
                    onChange={(e) => update(day, (rs) => rs.map((x) => (x.key === r.key ? { ...x, start: e.target.value } : x)))}
                    aria-label={`${label}, début`}
                    className="h-10 w-32"
                  />
                  <span aria-hidden>→</span>
                  <Input
                    type="time"
                    step={900}
                    value={r.end === "24:00" ? "23:59" : r.end}
                    disabled={!canEdit}
                    onChange={(e) => update(day, (rs) => rs.map((x) => (x.key === r.key ? { ...x, end: e.target.value } : x)))}
                    aria-label={`${label}, fin`}
                    className="h-10 w-32"
                  />
                  {hybrid && (
                    <Select
                      value={r.place}
                      disabled={!canEdit}
                      onChange={(e) => update(day, (rs) => rs.map((x) => (x.key === r.key ? { ...x, place: e.target.value as Range["place"] } : x)))}
                      aria-label={`${label}, lieu`}
                      className="h-10 w-auto min-w-44"
                    >
                      <option value="">Domicile et institut</option>
                      <option value="salon">Institut uniquement</option>
                      <option value="home">Domicile uniquement</option>
                    </Select>
                  )}
                  {canEdit && (
                    <Button type="button" variant="ghost" size="icon" className="size-10" onClick={() => update(day, (rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Supprimer cette plage du ${label.toLowerCase()}`}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => addRange(day)}>
                    <Plus /> Ajouter une plage
                  </Button>
                  {day < 5 && days[day].length > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => copyToWeekdays(day)}>
                      <Copy /> Copier sur lundi–vendredi
                    </Button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {result && <FormAlert type={result.type}>{result.text}</FormAlert>}
      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" size="lg" onClick={save} disabled={pending} aria-busy={pending}>
            {pending ? "Enregistrement…" : "Enregistrer les horaires"}
          </Button>
        </div>
      )}
    </section>
  );
}

export interface ExceptionItem {
  id: string;
  kind: keyof typeof EXCEPTION_KIND_LABELS;
  label: string | null;
  period: string;
  place: Place | null;
}

export function ExceptionsManager({ items, hybrid, canEdit, today }: { items: ExceptionItem[]; hybrid: boolean; canEdit: boolean; today: string }) {
  const [state, action] = useActionState(addExceptionAction, {});
  const [allDay, setAllDay] = useState(state.values ? state.values.all_day === "on" : true);
  const fe = state.fieldErrors ?? {};
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="blocks-title">
      <div>
        <h2 id="blocks-title" className="font-display text-lg font-bold">
          Congés, fermetures et indisponibilités
        </h2>
        <p className="text-sm text-muted-foreground">Aucun rendez-vous ne pourra être pris pendant ces périodes.</p>
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarOff className="size-4" /> Aucune période bloquée à venir.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
              <div>
                <p className="font-semibold">
                  {EXCEPTION_KIND_LABELS[e.kind]}
                  {e.label ? ` · ${e.label}` : ""}
                  {e.place ? ` · ${e.place === "home" ? "domicile" : "institut"} uniquement` : ""}
                </p>
                <p className="text-muted-foreground">{e.period}</p>
              </div>
              {canEdit && (
                <ActionButton
                  action={deleteExceptionAction}
                  fields={{ id: e.id }}
                  ariaLabel="Supprimer cette période"
                  confirm={{ title: "Supprimer cette période bloquée ?", description: e.period, confirmLabel: "Supprimer" }}
                >
                  <Trash2 />
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form action={action} className="flex flex-col gap-4 rounded-xl bg-surface p-4" noValidate>
          <p className="font-semibold">Bloquer une période</p>
          {state.error && <FormAlert type="error">{state.error}</FormAlert>}
          {state.success && <FormAlert type="success">{state.success}</FormAlert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kind">Type</Label>
              <Select id="kind" name="kind" defaultValue={state.values?.kind ?? "vacation"}>
                {Object.entries(EXCEPTION_KIND_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <Field label="Libellé (facultatif)" name="label" defaultValue={state.values?.label} placeholder="Ex. vacances d'été" maxLength={120} />
          </div>
          <Checkbox name="all_day" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} label="Journées entières" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Du" name="from_date" type="date" min={today} defaultValue={state.values?.from_date ?? today} error={fe.from_date} />
            <Field label="Au" name="to_date" type="date" min={today} defaultValue={state.values?.to_date ?? today} error={fe.to_date} />
            {!allDay && (
              <>
                <Field label="De" name="from_time" type="time" step={900} defaultValue={state.values?.from_time ?? "12:00"} error={fe.from_time} />
                <Field label="À" name="to_time" type="time" step={900} defaultValue={state.values?.to_time ?? "14:00"} />
              </>
            )}
          </div>
          {hybrid && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exc-place">Concerne</Label>
              <Select id="exc-place" name="place" defaultValue={state.values?.place ?? ""}>
                <option value="">Domicile et institut</option>
                <option value="salon">Institut uniquement</option>
                <option value="home">Domicile uniquement</option>
              </Select>
            </div>
          )}
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Enregistrement…">Bloquer cette période</SubmitButton>
          </div>
        </form>
      )}
    </section>
  );
}
