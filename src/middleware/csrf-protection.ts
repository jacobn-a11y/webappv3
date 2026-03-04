import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import logger from "../lib/logger.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

if (!process.env.CSRF_SECRET) {
  logger.warn("CSRF_SECRET not set — using random fallback. Set CSRF_SECRET in production.");
}

const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString("hex");

function computeCsrfToken(sessionToken: string): string {
  return crypto.createHmac("sha256", CSRF_SECRET).update(sessionToken).digest("hex");
}

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
    ...(process.env.NODE_ENV !== "production"
      ? ["http://localhost:3000", "http://localhost:5173"]
      : []),
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
    const authHeader = req.headers.authorization;
    const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;
    const tokenForCsrf = sessionToken || bearerToken;
    if (!tokenForCsrf) {
      next();
      return;
    }

    const csrfToken = readHeader(req.headers["x-csrf-token"]);
    const expectedCsrf = computeCsrfToken(tokenForCsrf);
    const isValidCsrf = csrfToken
      ? safeTokenMatch(csrfToken, expectedCsrf) || safeTokenMatch(csrfToken, tokenForCsrf)
      : false;
    if (!isValidCsrf) {
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

export function getCsrfToken(sessionToken: string): string {
  return computeCsrfToken(sessionToken);
}

function safeTokenMatch(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (provided.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}
