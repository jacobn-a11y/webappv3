/**
 * Public Landing Page Renderer — Compatibility Shim
 *
 * Delegates to decomposed sub-modules:
 *   - public-page/renderer.ts   (route handler + HTML template composition)
 *   - public-page/sanitizers.ts (CSS, URL, and colour sanitizers)
 *   - public-page/styles.ts     (CSS string constants)
 */

import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { renderLandingPageHtml, registerRoutes } from "./public-page/renderer.js";
import { sanitizeCustomCss } from "./public-page/sanitizers.js";

// Re-export public API so existing imports continue to work unchanged.
export { renderLandingPageHtml, sanitizeCustomCss };

// ─── Route Factory ─────────────────────────────────────────────────────────

export function createPublicPageRoutes(prisma: PrismaClient): Router {
  const router = Router();
  registerRoutes({ router, prisma });
  return router;
}
