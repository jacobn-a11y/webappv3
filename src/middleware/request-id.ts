/**
 * Request ID Middleware
 *
 * Generates a unique request ID for each incoming request, attaches it to the
 * response headers, and establishes an AsyncLocalStorage context so the logger
 * can automatically include it in all log entries for that request.
 */

import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { requestStore, type RequestContext } from "../lib/logger.js";

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId =
    (req.headers["x-request-id"] as string) ?? uuidv4();

  res.setHeader("x-request-id", requestId);

  const ctx: RequestContext = {
    requestId,
    method: req.method,
    path: req.path,
    organizationId: (req as unknown as Record<string, unknown>).organizationId as string | undefined,
    userId: (req as unknown as Record<string, unknown>).userId as string | undefined,
  };

  requestStore.run(ctx, () => next());
}
