interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ResponseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  async getOrSet(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await loader();
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
