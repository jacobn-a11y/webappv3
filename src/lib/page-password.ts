import crypto from "crypto";

const HASH_PREFIX = "pbkdf2_sha256";
const HASH_ITERATIONS = 120_000;
const HASH_KEYLEN = 32;
const HASH_DIGEST = "sha256";

export function hashPagePassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(
    password,
    salt,
    HASH_ITERATIONS,
    HASH_KEYLEN,
    HASH_DIGEST
  );
  return [
    HASH_PREFIX,
    String(HASH_ITERATIONS),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

function verifyHashedPassword(password: string, storedHash: string): boolean {
  const [prefix, roundsText, saltBase64, digestBase64] = storedHash.split("$");
  if (!prefix || !roundsText || !saltBase64 || !digestBase64) return false;
  if (prefix !== HASH_PREFIX) return false;

  const rounds = Number.parseInt(roundsText, 10);
  if (!Number.isFinite(rounds) || rounds <= 0) return false;

  const salt = Buffer.from(saltBase64, "base64");
  const digest = Buffer.from(digestBase64, "base64");
  const derived = crypto.pbkdf2Sync(password, salt, rounds, digest.length, HASH_DIGEST);

  if (derived.length !== digest.length) return false;
  return crypto.timingSafeEqual(derived, digest);
}

function verifyPlaintextFallback(password: string, storedValue: string): boolean {
  const candidate = Buffer.from(password, "utf8");
  const stored = Buffer.from(storedValue, "utf8");
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

/**
 * Verifies a password against the stored value.
 * Supports both new hashed values and legacy plaintext values.
 */
export function verifyPagePassword(password: string, storedValue: string): boolean {
  if (storedValue.startsWith(`${HASH_PREFIX}$`)) {
    return verifyHashedPassword(password, storedValue);
  }
  return verifyPlaintextFallback(password, storedValue);
}
