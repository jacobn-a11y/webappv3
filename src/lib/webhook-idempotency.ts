import { createClient, type RedisClientType } from "redis";

let redisClient: RedisClientType | null = null;

async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redisClient = createClient({ url }) as RedisClientType;
    await redisClient.connect();
    return redisClient;
  } catch {
    return null;
  }
}

const fallbackMap = new Map<string, number>();

function pruneFallback(nowMs: number): void {
  for (const [key, expiresAt] of fallbackMap.entries()) {
    if (expiresAt <= nowMs) {
      fallbackMap.delete(key);
    }
  }
}

/**
 * Returns true if this webhook event key has not been seen recently.
 * Uses Redis when available, falls back to in-memory for dev/test.
 */
export async function markWebhookEventIfNew(
  key: string,
  ttlMs = 5 * 60 * 1000
): Promise<boolean> {
  const normalizedKey = key.trim();
  if (!normalizedKey) return true;

  const redis = await getRedisClient();
  if (redis) {
    const redisKey = `webhook:idempotency:${normalizedKey}`;
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const result = await redis.set(redisKey, "1", { NX: true, EX: ttlSeconds });
    return result !== null;
  }

  const now = Date.now();
  pruneFallback(now);
  const existing = fallbackMap.get(normalizedKey);
  if (existing && existing > now) {
    return false;
  }
  fallbackMap.set(normalizedKey, now + Math.max(1000, ttlMs));
  return true;
}
