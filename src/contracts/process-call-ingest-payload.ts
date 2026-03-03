import { z } from "zod";

export const EXPORTER4_REQUIRED_INGEST_FIELDS = [
  "callId",
  "organizationId",
  "accountId",
  "hasTranscript",
] as const;

export const ProcessCallIngestPayloadSchema = z.object({
  callId: z.string().min(1),
  organizationId: z.string().min(1),
  accountId: z.string().nullable(),
  hasTranscript: z.boolean(),
  userId: z.string().min(1).optional(),
});

export type ProcessCallIngestPayload = z.infer<typeof ProcessCallIngestPayloadSchema>;

export function parseProcessCallIngestPayload(
  payload: unknown
): ProcessCallIngestPayload {
  return ProcessCallIngestPayloadSchema.parse(payload);
}
