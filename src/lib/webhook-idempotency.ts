const seenWebhookEvents = new Map<string, number>();

function pruneExpired(nowMs: number): void {
  for (const [key, expiresAt] of seenWebhookEvents.entries()) {
    if (expiresAt <= nowMs) {
      seenWebhookEvents.delete(key);
    }
  }
}

/**
 * Returns true if this webhook event key has not been seen recently.
 * Returns false for likely duplicate deliveries inside the TTL window.
 */
export function markWebhookEventIfNew(
  key: string,
  ttlMs = 5 * 60 * 1000
): boolean {
  const normalizedKey = key.trim();
  if (!normalizedKey) return true;
  const now = Date.now();
  pruneExpired(now);
  const existing = seenWebhookEvents.get(normalizedKey);
  if (existing && existing > now) {
    return false;
  }
  seenWebhookEvents.set(normalizedKey, now + Math.max(1000, ttlMs));
  return true;
}
