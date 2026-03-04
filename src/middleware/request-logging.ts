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
    const path = req.path;

    logger.log(level, `${req.method} ${path} ${res.statusCode}`, {
      method: req.method,
      url: path,
      statusCode: res.statusCode,
      durationMs: duration,
      contentLength: res.getHeader("content-length"),
    });
  });

  next();
}
