import { z } from "zod";

export const QuoteListQuerySchema = z.object({
  q: z.string().max(300).optional(),
  tier: z.enum(["AUTO", "CURATED", "ALL"]).optional(),
  account_id: z.string().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  starred: z.union([z.literal("true"), z.literal("false")]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const AttributionSchema = z.object({
  display: z.enum(["DISPLAYED", "HIDDEN", "OBFUSCATED"]),
});

export const SaveQuoteFromTranscriptSchema = z.object({
  call_id: z.string().min(1),
  source_chunk_id: z.string().min(1),
  quote_text: z.string().min(1).max(1000).optional(),
  curation_note: z.string().max(1000).optional(),
});

export const CurationSchema = z.object({
  curation_note: z.string().max(1000).optional(),
});
