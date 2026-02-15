/**
 * Request Logging Middleware
 *
 * Logs every incoming HTTP request with method, path, status code,
 * and response time. Relies on the request ID middleware for tracing.
 */

import type { Request, Response, NextFunction } from "express";
import logger from "../lib/logger.js";

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    logger.log(level, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: duration,
      contentLength: res.getHeader("content-length"),
    });
  });

  next();
}
