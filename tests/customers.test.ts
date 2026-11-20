import { describe, expect, it } from "vitest";
import { displayName, duplicateReasons, findDuplicates, importKey, normalizePhone } from "@/lib/domain/customers";
import { analyzeImport, guessMapping, mapRows, parseBirthDate, parseCsv, summarize } from "@/lib/domain/csv-import";

const person = (o: Partial<Parameters<typeof duplicateReasons>[0]> = {}) => ({
  first_name: "Camille",
  last_name: "Martin",
  email: null,
  phone: null,
  birth_date: null,
  ...o,
});

describe("normalisation", () => {
  it("ramène les numéros français au format national", () => {
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("0612345678");
    expect(normalizePhone("0033612345678")).toBe("0612345678");
    expect(normalizePhone("06.12.34.56.78")).toBe("0612345678");
    expect(normalizePhone("")).toBeNull();
  });
  it("affiche un nom lisible", () => {
    expect(displayName({ first_name: " Léa ", last_name: "Durand" })).toBe("Léa Durand");
    expect(displayName({ first_name: "", last_name: "" })).toBe("Sans nom");
  });
});

describe("détection des doublons", () => {
  it("par email (casse ignorée) ou téléphone", () => {
    expect(duplicateReasons(person({ email: "A@x.fr" }), person({ email: "a@x.fr", first_name: "Autre" }))).toEqual(["email"]);
    expect(duplicateReasons(person({ phone: "+33612345678" }), person({ phone: "06 12 34 56 78" }))).toEqual(["phone"]);
  });
  it("par nom (accents ignorés) ET date de naissance", () => {
    expect(duplicateReasons(person({ first_name: "Léa", birth_date: "1990-01-01" }), person({ first_name: "lea", birth_date: "1990-01-01" }))).toEqual([
      "name_birthdate",
    ]);
  });
  it("un simple homonyme n'est pas un doublon", () => {
    expect(duplicateReasons(person(), person())).toEqual([]);
  });
  it("ignore la fiche elle-même lors d'une modification", () => {
    const existing = [{ ...person({ email: "a@x.fr" }), id: "1" }];
    expect(findDuplicates({ ...person({ email: "a@x.fr" }), id: "1" }, existing)).toEqual([]);
    expect(findDuplicates(person({ email: "a@x.fr" }), existing)).toHaveLength(1);
  });
  it("produit une clé d'import stable malgré la mise en forme", async () => {
    const k1 = await importKey(person({ first_name: "Léa", email: "LEA@x.fr", phone: "+33 6 12 34 56 78" }));
    const k2 = await importKey(person({ first_name: "lea ", email: "lea@x.fr", phone: "0612345678" }));
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("lecture CSV", () => {
  it("gère point-virgule, guillemets, retours à la ligne et BOM", () => {
    const csv = '﻿Prénom;Nom;Notes\r\nLéa;Durand;"Aime le thé; pas de café"\r\nInès;"Ben ""Ali""";"ligne 1\nligne 2"\r\n';
    expect(parseCsv(csv)).toEqual([
      ["Prénom", "Nom", "Notes"],
      ["Léa", "Durand", "Aime le thé; pas de café"],
      ["Inès", 'Ben "Ali"', "ligne 1\nligne 2"],
    ]);
  });
  it("détecte la virgule et ignore les lignes vides", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("devine la correspondance des colonnes", () => {
    expect(guessMapping(["Prénom", "Nom", "E-mail", "Téléphone portable", "Date de naissance", "Code postal", "Ville", "Adresse"])).toMatchObject({
      firstName: 0,
      lastName: 1,
      email: 2,
      birthDate: 4,
      postalCode: 5,
      city: 6,
      addressLine1: 7,
    });
    expect(guessMapping(["Client", "Mail"])).toEqual({ fullName: 0, email: 1 });
  });
  it("lit les dates de naissance françaises et ISO", () => {
    const today = new Date("2026-11-20");
    expect(parseBirthDate("12/03/1990", today)).toBe("1990-03-12");
    expect(parseBirthDate("1990-03-12", today)).toBe("1990-03-12");
    expect(parseBirthDate("31/02/1990", today)).toBeUndefined();
    expect(parseBirthDate("01/01/2030", today)).toBeUndefined();
    expect(parseBirthDate("", today)).toBeNull();
  });
});

describe("analyse d'import", () => {
  const rows = parseCsv(
    [
      "Prénom;Nom;Email;Téléphone;Adresse;Ville",
      "Léa;Durand;lea@x.fr;0611111111;1 rue A;Toulouse",
      "Inès;Martin;ines@x.fr;;;",
      ";;sans-nom@x.fr;;;",
      "Inès;Martin;INES@x.fr;;;",
      "Zoé;Bernard;zoe@x.fr;;2 rue B;",
      "Emma;Petit;existante@x.fr;;;",
      "Jade;Roux;jade@x.fr;;;",
    ].join("\n"),
  );
  const candidates = mapRows(rows, guessMapping(rows[0]));

  it("signale les erreurs ligne par ligne", () => {
    expect(candidates[2].errors).toContain("Nom manquant");
    expect(candidates[4].errors[0]).toMatch(/Adresse incomplète/);
    expect(candidates[0].address).toEqual({ line1: "1 rue A", postalCode: null, city: "Toulouse" });
    expect(candidates[0].line).toBe(2);
  });

  it("classe chaque ligne sans jamais modifier l'existant", async () => {
    const keyed = await Promise.all(candidates.map(async (c) => ({ candidate: c, key: await importKey(c) })));
    const jadeKey = keyed[6].key;
    const result = analyzeImport(
      keyed,
      [{ id: "c1", first_name: "Emma", last_name: "P.", email: "existante@x.fr", phone: null, birth_date: null }],
      new Set([jadeKey]),
    );
    expect(result.map((r) => r.status)).toEqual(["new", "new", "invalid", "duplicate_in_file", "invalid", "duplicate_existing", "already_imported"]);
    expect(result[5].matches[0]).toMatchObject({ customerId: "c1", reasons: ["email"] });
    expect(summarize(result)).toEqual({ new: 2, invalid: 2, duplicate_existing: 1, duplicate_in_file: 1, already_imported: 1 });
  });
});
