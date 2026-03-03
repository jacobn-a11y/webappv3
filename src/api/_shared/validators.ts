import type { Response } from "express";
import type { ZodSchema } from "zod";

export function parseRequestBody<T>(
  schema: ZodSchema<T>,
  body: unknown,
  res: Response
): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", details: parsed.error.issues });
    return null;
  }
  return parsed.data;
}
