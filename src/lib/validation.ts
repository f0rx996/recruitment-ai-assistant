import { z } from "zod";

/** Strips control characters (except tab/newline) and trims. */
export function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

const text = (min: number, max: number, label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .transform(cleanText)
    .pipe(
      z
        .string()
        .min(min, min > 0 ? `${label} must be at least ${min} characters` : undefined)
        .max(max, `${label} must be at most ${max} characters`),
    );

export const applicationInputSchema = z.object({
  fullName: text(2, 120, "Full name").refine((v) => /\p{L}/u.test(v), "Full name must contain letters"),
  email: z
    .string({ required_error: "Email is required" })
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().email("Enter a valid email address").max(254)),
  phone: z
    .string({ required_error: "Phone number is required" })
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .regex(/^\+?[0-9][0-9\s().-]{5,30}$/, "Enter a valid phone number")
        .refine((v) => v.replace(/\D/g, "").length >= 6, "Enter a valid phone number"),
    ),
  consent: z.literal(true, {
    errorMap: () => ({ message: "You must agree to the privacy notice and AI-assisted CV processing" }),
  }),
});
export type ApplicationInput = z.infer<typeof applicationInputSchema>;

/** Accepts either an array or a newline/comma-separated string. */
const skillList = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => {
    const items = Array.isArray(v) ? v : v.split(/[\n,]/);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
      const s = cleanText(raw).slice(0, 100);
      const k = s.toLowerCase();
      if (s && !seen.has(k)) {
        seen.add(k);
        out.push(s);
      }
    }
    return out;
  })
  .pipe(z.array(z.string()).max(30, "At most 30 items"));

export const jobInputSchema = z.object({
  title: text(3, 120, "Job title"),
  summary: text(0, 300, "Short description").default(""),
  description: text(20, 10000, "Job description"),
  required_skills: skillList.refine((v) => v.length > 0, "Add at least one required skill or qualification"),
  preferred_skills: skillList.default([]),
  other_requirements: text(0, 3000, "Other requirements").default(""),
  location: text(0, 120, "Location").default(""),
  status: z.enum(["open", "closed"]).default("open"),
});
export type JobInput = z.infer<typeof jobInputSchema>;

export const jobPatchSchema = jobInputSchema.partial();

export const reviewStatusSchema = z.object({
  review_status: z.enum(["new", "reviewed", "shortlisted", "rejected"]),
});

export const chatRequestSchema = z.object({
  sessionId: z.string().uuid().optional().nullable(),
  message: text(1, 4000, "Message"),
});

export function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "job";
}

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
