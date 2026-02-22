/**
 * Supertest request helper that fixes the "Cannot read properties of null (reading 'port')" bug.
 *
 * Supertest v7's serverAddress() reads app.address().port immediately after app.listen(0),
 * but listen() is async—address() can still be null. This helper starts the server, waits
 * for it to be ready, then returns a request function bound to the server.
 *
 * Usage:
 *   const { request, close } = await requestServer(app);
 *   try {
 *     const res = await request().post("/api/rag/query").send({});
 *     expect(res.status).toBe(400);
 *   } finally {
 *     close();
 *   }
 */

import type { Application } from "express";
import { createServer, type Server } from "http";
import request from "supertest";

export interface RequestServerResult {
  /** Request bound to the listening server. Use with .get(), .post(), etc. */
  request: ReturnType<typeof request>;
  /** Close the server. Call in afterEach or finally. */
  close: () => void;
  /** The underlying HTTP server (for advanced use). */
  server: Server;
}

/**
 * Start the Express app on a random port and return a request function.
 * Use this instead of request(app) when tests fail with "port" null errors.
 */
export async function requestServer(app: Application): Promise<RequestServerResult> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => resolve());
    server.once("error", reject);
  });
  return {
    request: request(server),
    close: () => server.close(),
    server,
  };
}

/**
 * Run a callback with a request function, ensuring the server is closed afterward.
 * Use for tests that need one or more requests against the same app.
 */
export async function withRequestServer<T>(
  app: Application,
  fn: (req: RequestServerResult["request"]) => Promise<T>
): Promise<T> {
  const { request, close } = await requestServer(app);
  try {
    return await fn(request);
  } finally {
    close();
  }
}
