import { z } from "zod";

/**
 * Mirrors the validation rules in the Kindred repo's lib/contacts.ts
 * (validateContact). Keep in sync with that file.
 */

const currentYear = new Date().getUTCFullYear();

export const contactInputSchema = z.object({
  first_name: z
    .string()
    .min(1, "First name is required")
    .max(200, "First name is too long"),
  last_name: z.string().max(200, "Last name is too long").optional(),
  birth_month: z
    .number()
    .int()
    .min(1, "Birth month must be an integer between 1 and 12")
    .max(12, "Birth month must be an integer between 1 and 12"),
  birth_day: z
    .number()
    .int()
    .min(1, "Birth day is not valid for the given month")
    .max(31, "Birth day is not valid for the given month"),
  birth_year: z
    .number()
    .int()
    .min(1800, "Birth year must be an integer between 1800 and the current year")
    .max(
      currentYear,
      "Birth year must be an integer between 1800 and the current year",
    )
    .nullable()
    .optional(),
  notes: z
    .string()
    .max(10000, "Notes must be text under 10000 characters")
    .optional(),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

/** Contact as returned by GET endpoints (includes server-computed days_until). */
export interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  birth_month: number;
  birth_day: number;
  birth_year: number | null;
  notes: string;
  days_until: number;
}

/** Contact shape on POST/PUT responses (no days_until). */
export interface ContactStored {
  id: number;
  first_name: string;
  last_name: string;
  birth_month: number;
  birth_day: number;
  birth_year: number | null;
  notes: string;
}

export interface KindredErrorBody {
  error: string;
}
