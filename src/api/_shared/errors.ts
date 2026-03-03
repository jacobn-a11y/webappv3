import type { Response } from "express";

export function respondAuthRequired(res: Response): void {
  res.status(401).json({ error: "Authentication required" });
}

export function respondServerError(
  res: Response,
  logLabel: string,
  userMessage: string,
  err: unknown
): void {
  console.error(logLabel, err);
  res.status(500).json({ error: userMessage });
}
