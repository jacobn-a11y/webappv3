/**
 * Tag Cache
 *
 * In-memory LRU cache keyed by a SHA-256 hash of the chunk text.
 * Prevents redundant LLM calls when the same (or re-processed) chunk
 * text is encountered again. Entries expire after a configurable TTL.
 */

import { createHash } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TagCacheEntry {
  tags: CachedTag[];
  createdAt: number; // epoch ms
}

export interface CachedTag {
  funnelStage: string;
  topic: string;
  confidence: number;
}

export interface TagCacheOptions {
  /** Maximum number of entries (default: 10 000) */
  maxSize: number;
  /** Time-to-live in milliseconds (default: 1 hour) */
  ttlMs: number;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class TagCache {
  private cache = new Map<string, TagCacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  // Stats for observability
  private _hits = 0;
  private _misses = 0;

  constructor(options: TagCacheOptions) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
  }

  /**
   * Compute a deterministic cache key from chunk text.
   */
  static hashText(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }

  /**
   * Look up cached tags for a given chunk text.
   * Returns the cached tags or null on miss / expired entry.
   */
  get(text: string): CachedTag[] | null {
    const key = TagCache.hashText(text);
    const entry = this.cache.get(key);

    if (!entry) {
      this._misses++;
      return null;
    }

    // Check TTL expiry
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      this._misses++;
      return null;
    }

    // Move to end for LRU freshness (Map iteration order = insertion order)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this._hits++;
    return entry.tags;
  }

  /**
   * Store tags in the cache for a given chunk text.
   */
  set(text: string, tags: CachedTag[]): void {
    const key = TagCache.hashText(text);

    // If already present, delete first so it moves to end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { tags, createdAt: Date.now() });
  }

  /**
   * Cache statistics.
   */
  get stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      size: this.cache.size,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
    };
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this._hits = 0;
    this._misses = 0;
  }
}
