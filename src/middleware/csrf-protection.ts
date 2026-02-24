import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readHeader(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first?.trim() || null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveAllowedOrigins(): Set<string> {
  const configured = (process.env.CSRF_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const defaults = [
    process.env.APP_URL,
    process.env.FRONTEND_URL,
    "http://localhost:3000",
    "http://localhost:5173",
  ].filter((origin): origin is string => !!origin);
  return new Set([...configured, ...defaults]);
}

function extractOriginFromReferer(referer: string): string | null {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function createCsrfProtection() {
  const allowedOrigins = resolveAllowedOrigins();

  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const sessionToken = readHeader(req.headers["x-session-token"]);
    // Only enforce for session-token authenticated browser requests.
    if (!sessionToken) {
      next();
      return;
    }

    const csrfToken = readHeader(req.headers["x-csrf-token"]);
    if (!csrfToken || csrfToken !== sessionToken) {
      res.status(403).json({
        error: "csrf_validation_failed",
        message:
          "Missing or invalid CSRF token. Send x-csrf-token with the current session token for write requests.",
      });
      return;
    }

    const origin = readHeader(req.headers.origin);
    const referer = readHeader(req.headers.referer);
    const requestOrigin = origin ?? (referer ? extractOriginFromReferer(referer) : null);
    if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
      res.status(403).json({
        error: "csrf_origin_rejected",
        message: "Request origin is not allowed for state-changing operations.",
      });
      return;
    }

    next();
  };
}
