import { z } from "zod";
import { parseBirthDate } from "@/lib/domain/csv-import";

const optional = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .optional()
    .transform((v) => v || null);

export const customerSchema = z
  .object({
    first_name: z.string().trim().max(80, "80 caractères maximum.").default(""),
    last_name: z.string().trim().max(80, "80 caractères maximum.").default(""),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .optional()
      .refine((v) => !v || z.email().safeParse(v).success, "Adresse email invalide.")
      .transform((v) => v || null),
    phone: z
      .string()
      .trim()
      .max(30, "Numéro trop long.")
      .optional()
      .refine((v) => !v || /^\+?[0-9 .()-]{6,}$/.test(v), "Numéro de téléphone invalide.")
      .transform((v) => v || null),
    birth_date: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const parsed = parseBirthDate(v);
        if (parsed === undefined) {
          ctx.addIssue({ code: "custom", message: "Date invalide." });
          return z.NEVER;
        }
        return parsed;
      }),
    notes: optional(5000, "5000 caractères maximum."),
  })
  .refine((v) => v.first_name || v.last_name, { message: "Indiquez au moins un prénom ou un nom.", path: ["first_name"] });

export const addressSchema = z.object({
  kind: z.enum(["home", "work", "other"], { error: "Type d'adresse invalide." }),
  label: optional(60, "60 caractères maximum."),
  line1: z.string().trim().min(1, "Adresse requise.").max(200, "200 caractères maximum."),
  line2: optional(200, "200 caractères maximum."),
  postal_code: optional(12, "Code postal trop long."),
  city: z.string().trim().min(1, "Ville requise.").max(100, "100 caractères maximum."),
});

export const preferencesSchema = z.object({
  contact_preference: z.enum(["any", "email", "sms", "phone", "none"], { error: "Choix invalide." }),
  preferences: optional(2000, "2000 caractères maximum."),
});
