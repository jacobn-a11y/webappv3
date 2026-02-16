import { describe, it, expect } from "vitest";
import {
  globalRateLimiter,
  expensiveRateLimiter,
  webhookRateLimiter,
  authRateLimiter,
} from "../src/middleware/rate-limiter.js";

describe("rate limiter exports", () => {
  it("exports globalRateLimiter as a function (middleware)", () => {
    expect(typeof globalRateLimiter).toBe("function");
  });

  it("exports expensiveRateLimiter as a function (middleware)", () => {
    expect(typeof expensiveRateLimiter).toBe("function");
  });

  it("exports webhookRateLimiter as a function (middleware)", () => {
    expect(typeof webhookRateLimiter).toBe("function");
  });

  it("exports authRateLimiter as a function (middleware)", () => {
    expect(typeof authRateLimiter).toBe("function");
  });
});
