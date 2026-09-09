import { z } from "zod";

export const signerDetailsSchema = z.strictObject({
  signerName: z.string().trim()
    .min(1, "Your full name is required.")
    .max(120, "Your full name must be 120 characters or fewer."),
  signerEmail: z.string().trim().max(254).pipe(z.email("Enter a valid signer email.")),
  signedDate: z.iso.date("Enter a valid agreement date."),
  agreed: z.boolean().refine((value) => value, "Confirm that you have read and agree to continue."),
});

export type SignerDetails = z.infer<typeof signerDetailsSchema>;
