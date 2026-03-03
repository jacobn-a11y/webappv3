import type { Response } from "express";

/**
 * Standardized API response helpers.
 * All API responses should use these to ensure consistent envelope format.
 */

export interface ApiErrorResponse {
  error: string;
  message?: string;
  details?: unknown;
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json(data);
}

export function sendCreated<T>(res: Response, data: T): void {
  res.status(201).json(data);
}

export function sendNoContent(res: Response): void {
  res.status(204).send();
}

export function sendError(
  res: Response,
  statusCode: number,
  error: string,
  message?: string,
  details?: unknown
): void {
  const body: ApiErrorResponse = { error };
  if (message) body.message = message;
  if (details) body.details = details;
  res.status(statusCode).json(body);
}

export function sendBadRequest(res: Response, message: string, details?: unknown): void {
  sendError(res, 400, "bad_request", message, details);
}

export function sendUnauthorized(res: Response, message = "Authentication required"): void {
  sendError(res, 401, "unauthorized", message);
}

export function sendForbidden(res: Response, message = "Permission denied"): void {
  sendError(res, 403, "forbidden", message);
}

export function sendNotFound(res: Response, message = "Resource not found"): void {
  sendError(res, 404, "not_found", message);
}

export function sendConflict(res: Response, message: string): void {
  sendError(res, 409, "conflict", message);
}

export function sendServiceUnavailable(res: Response, message = "Service temporarily unavailable"): void {
  sendError(res, 503, "service_unavailable", message);
}
