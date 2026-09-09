import { z } from "zod";

const requiredText = (label: string, maximum: number) => z.string()
  .trim()
  .min(1, `${label} is required.`)
  .max(maximum, `${label} must be ${maximum} characters or fewer.`);

export const productionSetupSchema = z.strictObject({
  productionName: requiredText("Production or producer name", 120),
  signatureCollector: z.string().trim().max(120, "Signature collector must be 120 characters or fewer."),
  productionEmail: z.string().trim().max(254).pipe(z.email("Enter a valid production email.")),
  projectTitle: requiredText("Project title", 160),
  agreementDate: z.iso.date("Enter a valid agreement date."),
  photoRequired: z.boolean(),
});

export type ProductionSetup = z.infer<typeof productionSetupSchema>;

export const SYNTHETIC_RELEASE_TEXT = `TEST CONTENT ONLY — NOT A LEGAL AGREEMENT

This synthetic release exists only to test SealProof's document workflow, typography, page limits, and exact-document review. It grants no rights and creates no obligations.

The participant in this software test acknowledges that the names, project information, dates, and contact details shown in the generated preview are test inputs. No production may rely on this text as an agreement.

SealProof will eventually explain its temporary processing, delivery, retention, and deletion behavior in reviewed language. This placeholder is not that disclosure.`;

export function todayForDateInput(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
