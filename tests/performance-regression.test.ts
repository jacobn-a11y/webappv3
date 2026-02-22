import { describe, expect, it } from "vitest";
import { ResponseCache } from "../src/lib/response-cache.js";
import { parseBoundedLimit, PAGINATION_LIMITS } from "../src/lib/pagination.js";

describe("performance regression guards", () => {
  it("keeps response-cache hot-path operations within budget", async () => {
    const cache = new ResponseCache<number>(60_000);

    await cache.getOrSet("k", async () => 42);

    const iterations = 100_000;
    const started = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const value = await cache.getOrSet("k", async () => 99);
      if (value !== 42) {
        throw new Error("cache regression: expected cached value");
      }
    }
    const elapsed = performance.now() - started;

    // Generous threshold to reduce CI flake while still catching major regressions.
    expect(elapsed).toBeLessThan(1500);
  });

  it("keeps pagination limit parsing throughput within budget", () => {
    const iterations = 250_000;
    const started = performance.now();

    for (let i = 0; i < iterations; i += 1) {
      const parsed = parseBoundedLimit(i % 5000, {
        fallback: PAGINATION_LIMITS.LIST_DEFAULT,
        max: PAGINATION_LIMITS.LIST_MAX,
      });
      if (parsed < 1 || parsed > PAGINATION_LIMITS.LIST_MAX) {
        throw new Error("parse regression: out-of-bounds result");
      }
    }

    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(900);
  });
});
