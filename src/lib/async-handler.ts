import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route handler to forward rejected promises
 * to the Express error pipeline. Required for Express 4.x which does
 * not natively handle async errors.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
