import { describe, it, expect } from "vitest";
import {
  createRateLimiter,
  apiRateLimiter,
  webhookRateLimiter,
  passwordRateLimiter,
} from "../src/middleware/rate-limiter.js";

describe("rate limiter exports", () => {
  it("exports apiRateLimiter as a function (middleware)", () => {
    expect(typeof apiRateLimiter).toBe("function");
  });

  it("exports passwordRateLimiter as a function (middleware)", () => {
    expect(typeof passwordRateLimiter).toBe("function");
  });

  it("exports webhookRateLimiter as a function (middleware)", () => {
    expect(typeof webhookRateLimiter).toBe("function");
  });

  it("exports createRateLimiter as a function (factory)", () => {
    expect(typeof createRateLimiter).toBe("function");
  });
});
