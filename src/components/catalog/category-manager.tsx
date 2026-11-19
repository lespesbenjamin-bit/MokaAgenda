"use client";

import { useActionState, useState } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Checkbox } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionButton } from "@/components/ui/action-button";
import { categoryQuickAction, createCategoryAction, updateCategoryAction } from "@/server/actions/catalog";
import type { FormState } from "@/lib/validation/auth";

export interface CategoryItem {
  id: string;
  name: string;
  description: string | null;
  isVisible: boolean;
  archived: boolean;
  serviceCount: number;
}

export const CATEGORY_EXAMPLES = ["Épilation", "Soins du visage", "Onglerie", "Extensions de cils", "Coiffure", "Massages bien-être", "Maquillage"];

export function CategoryManager({ categories, canEdit }: { categories: CategoryItem[]; canEdit: boolean }) {
  const active = categories.filter((c) => !c.archived);
  const archived = categories.filter((c) => c.archived);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
      <section aria-labelledby="cat-list" className="flex flex-col gap-3">
        <h2 id="cat-list" className="sr-only">
          Vos catégories
        </h2>
        {active.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-card px-6 py-12 text-center">
            <Tags className="size-7 text-primary" />
            <p className="font-display text-lg font-bold">Aucune catégorie pour l&apos;instant</p>
            <p className="max-w-sm text-sm text-muted-foreground">Exemples : {CATEGORY_EXAMPLES.slice(0, 5).join(", ")}…</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {active.map((c, i) => (
              <CategoryRow key={c.id} c={c} first={i === 0} last={i === active.length - 1} canEdit={canEdit} />
            ))}
          </ol>
        )}
        {archived.length > 0 && (
          <details className="mt-4 rounded-2xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold">Catégories archivées ({archived.length})</summary>
            <ul className="mt-3 flex flex-col gap-2">
              {archived.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{c.name}</span>
                  {canEdit && (
                    <ActionButton action={categoryQuickAction} fields={{ id: c.id, op: "restore" }}>
                      <ArchiveRestore /> Restaurer
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {canEdit && <NewCategoryForm />}
    </div>
  );
}

function CategoryRow({ c, first, last, canEdit }: { c: CategoryItem; first: boolean; last: boolean; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <EditCategoryForm c={c} onDone={() => setEditing(false)} />;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {c.name}
          {!c.isVisible && <Badge variant="soon">Masquée</Badge>}
        </p>
        <p className="text-sm text-muted-foreground">
          {c.serviceCount} prestation{c.serviceCount > 1 ? "s" : ""}
          {c.description ? ` · ${c.description}` : ""}
        </p>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {!first && (
            <ActionButton action={categoryQuickAction} fields={{ id: c.id, op: "up" }} ariaLabel={`Monter ${c.name}`} variant="ghost">
              <ArrowUp />
            </ActionButton>
          )}
          {!last && (
            <ActionButton action={categoryQuickAction} fields={{ id: c.id, op: "down" }} ariaLabel={`Descendre ${c.name}`} variant="ghost">
              <ArrowDown />
            </ActionButton>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Modifier
          </Button>
          <ActionButton action={categoryQuickAction} fields={{ id: c.id, op: "toggle" }} ariaLabel={c.isVisible ? `Masquer ${c.name}` : `Afficher ${c.name}`}>
            {c.isVisible ? <EyeOff /> : <Eye />}
            <span className="sr-only sm:not-sr-only">{c.isVisible ? "Masquer" : "Afficher"}</span>
          </ActionButton>
          <ActionButton
            action={categoryQuickAction}
            fields={{ id: c.id, op: "archive" }}
            ariaLabel={`Archiver ${c.name}`}
            confirm={{
              title: `Archiver « ${c.name} » ?`,
              description: "Les prestations de cette catégorie sont conservées. Vous pourrez restaurer la catégorie à tout moment.",
              confirmLabel: "Archiver",
            }}
          >
            <Archive />
            <span className="sr-only sm:not-sr-only">Archiver</span>
          </ActionButton>
        </div>
      )}
    </li>
  );
}

function EditCategoryForm({ c, onDone }: { c: CategoryItem; onDone: () => void }) {
  const [state, action] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await updateCategoryAction(prev, fd);
    if (result.success) onDone();
    return result;
  }, {});
  return (
    <li className="rounded-2xl border border-primary/40 bg-card p-4">
      <form action={action} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="id" value={c.id} />
        {state.error && <FormAlert type="error">{state.error}</FormAlert>}
        <Field label="Nom" name="name" defaultValue={state.values?.name ?? c.name} error={state.fieldErrors?.name} />
        <Field label="Description (facultative)" name="description" defaultValue={state.values?.description ?? c.description ?? ""} error={state.fieldErrors?.description} />
        <Checkbox name="is_visible" defaultChecked={c.isVisible} label="Visible" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Annuler
          </Button>
          <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
        </div>
      </form>
    </li>
  );
}

function NewCategoryForm() {
  const [state, action] = useActionState(createCategoryAction, {});
  const [key, setKey] = useState(0);
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6" aria-labelledby="new-cat">
      <h2 id="new-cat" className="font-display text-lg font-bold">
        Ajouter une catégorie
      </h2>
      <form
        key={key}
        action={async (fd) => {
          await action(fd);
          setKey((k) => k + 1);
        }}
        className="mt-4 flex flex-col gap-3"
        noValidate
      >
        {state.error && <FormAlert type="error">{state.error}</FormAlert>}
        {state.success && <FormAlert type="success">{state.success}</FormAlert>}
        <Field label="Nom" name="name" placeholder="Soins du visage" defaultValue={state.values?.name} error={state.fieldErrors?.name} />
        <Field label="Description (facultative)" name="description" defaultValue={state.values?.description} error={state.fieldErrors?.description} />
        <Checkbox name="is_visible" defaultChecked label="Visible" hint="Une catégorie masquée n'apparaîtra pas sur votre future page de réservation." />
        <SubmitButton pendingLabel="Ajout…">
          <Plus /> Ajouter
        </SubmitButton>
      </form>
    </section>
  );
}
