import crypto from "crypto";

export function generateSessionToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  return {
    raw,
    hash: hashSessionToken(raw),
  };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

