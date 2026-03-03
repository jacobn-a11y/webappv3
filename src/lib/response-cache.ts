interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_MAX_SIZE = 500;
const PURGE_INTERVAL_MS = 60_000;

/**
 * In-memory cache with TTL and LRU eviction.
 *
 * Uses Map insertion order for LRU tracking: accessed entries are
 * re-inserted at the end so the least-recently-used entry is always
 * first. When the cache exceeds maxSize, the oldest (least recently
 * used) entries are evicted.
 */
export class ResponseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ttlMs: number, maxSize = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.purgeTimer = setInterval(() => this.purgeExpired(), PURGE_INTERVAL_MS);
    if (this.purgeTimer.unref) this.purgeTimer.unref();
  }

  async getOrSet(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }

    if (cached) this.entries.delete(key);

    const value = await loader();
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    this.evictIfNeeded();
    return value;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxSize) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
      else break;
    }
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  destroy(): void {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }
    this.entries.clear();
  }
}
