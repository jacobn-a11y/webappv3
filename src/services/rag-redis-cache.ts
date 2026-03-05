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

export async function getRagRedisCache<T>(redisKey: string): Promise<T | null> {
  try {
    const redis = await getRedisClient();
    if (!redis) return null;
    const raw = await redis.get(redisKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setRagRedisCache<T>(
  redisKey: string,
  value: T,
  cacheTtlMs: number
): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    if (!redis) return false;
    const ttlSeconds = Math.max(1, Math.ceil(cacheTtlMs / 1000));
    await redis.set(redisKey, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  } catch {
    return false;
  }
}
