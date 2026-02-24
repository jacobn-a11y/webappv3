import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCsrfProtection } from "../src/middleware/csrf-protection.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createCsrfProtection());
  app.get("/ok", (_req, res) => res.json({ ok: true }));
  app.post("/ok", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("csrf protection middleware", () => {
  afterEach(() => {
    delete process.env.CSRF_ALLOWED_ORIGINS;
  });

  it("allows safe-method requests without csrf token", async () => {
    const app = buildApp();
    await request(app).get("/ok").set("x-session-token", "session_1").expect(200);
  });

  it("allows write requests without session token", async () => {
    const app = buildApp();
    await request(app).post("/ok").send({ hello: "world" }).expect(200);
  });

  it("rejects write requests when session token is present but csrf token is missing", async () => {
    const app = buildApp();
    await request(app)
      .post("/ok")
      .set("x-session-token", "session_1")
      .send({ hello: "world" })
      .expect(403);
  });

  it("allows write requests with matching csrf + session token and trusted origin", async () => {
    const app = buildApp();
    await request(app)
      .post("/ok")
      .set("x-session-token", "session_1")
      .set("x-csrf-token", "session_1")
      .set("origin", "http://localhost:3000")
      .send({ hello: "world" })
      .expect(200);
  });

  it("rejects write requests from untrusted origins", async () => {
    process.env.CSRF_ALLOWED_ORIGINS = "https://app.example.com";
    const app = buildApp();
    const res = await request(app)
      .post("/ok")
      .set("x-session-token", "session_1")
      .set("x-csrf-token", "session_1")
      .set("origin", "https://evil.example")
      .send({ hello: "world" })
      .expect(403);
    expect(res.body.error).toBe("csrf_origin_rejected");
  });
});
