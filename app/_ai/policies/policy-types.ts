import { z } from "zod";

export const policyScopeSchema = z.enum(["public", "staff"]);
export type PolicyScope = z.infer<typeof policyScopeSchema>;

export const policyCitationSchema = z.object({
  documentId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  section: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excerpt: z.string().trim().min(1).max(420),
  scope: policyScopeSchema,
}).strict();

export type PolicyCitation = z.infer<typeof policyCitationSchema>;

export type PolicySearchResult =
  | {
      kind: "policy-search";
      status: "grounded";
      answerContext: string;
      citations: [PolicyCitation, ...PolicyCitation[]];
      truncated: boolean;
    }
  | {
      kind: "policy-search";
      status: "insufficient-evidence";
      answerContext: "";
      citations: [];
      truncated: false;
    };

export const policySearchInputSchema = z.object({
  question: z.string().trim().min(1).max(500),
}).strict();
