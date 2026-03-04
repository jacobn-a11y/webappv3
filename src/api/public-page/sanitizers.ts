/**
 * Public Page — Sanitizers
 *
 * Input sanitization helpers for user-provided CSS, image URLs,
 * hex colour values, and branding settings.
 */

// ─── CSS Sanitization ─────────────────────────────────────────────────────────

/**
 * Sanitizes user-provided custom CSS to prevent XSS attacks.
 * Strips dangerous constructs like script injection, @import rules,
 * javascript: URLs, expression(), -moz-binding, behavior:, and data: URIs.
 */
export function sanitizeCustomCss(css: string | null): string | null {
  if (css === null) return null;

  let sanitized = css;

  // Strip all HTML tags to prevent injection of <style>, <script>, or any other element
  sanitized = sanitized.replace(/<[^>]*>/g, "");

  // Remove @import rules (data exfiltration vector)
  sanitized = sanitized.replace(/@import\s+[^;]*;?/gi, "");

  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript\s*:/gi, "");

  // Remove CSS expression() (IE exploits)
  sanitized = sanitized.replace(/expression\s*\([^)]*\)/gi, "");

  // Remove -moz-binding (Firefox XBL injection)
  sanitized = sanitized.replace(/-moz-binding\s*:[^;]*(;|$)/gi, "");

  // Remove behavior: (IE HTC injection)
  sanitized = sanitized.replace(/behavior\s*:[^;]*(;|$)/gi, "");

  // Remove data: URIs in url()
  sanitized = sanitized.replace(/url\s*\(\s*["']?\s*data:[^)]*\)/gi, "");

  return sanitized;
}

// ─── URL Sanitization ─────────────────────────────────────────────────────────

export function sanitizeHeroImageUrl(url: string | null): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Hex Colour Sanitization ──────────────────────────────────────────────────

export function sanitizeHexColor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(trimmed) ? trimmed : null;
}

// ─── Branding Settings Sanitization ───────────────────────────────────────────

export function sanitizeBrandingSettings(branding: {
  brandName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  surfaceColor?: string | null;
} | null | undefined):
  | {
      brandName?: string;
      logoUrl?: string;
      primaryColor?: string;
      accentColor?: string;
      surfaceColor?: string;
    }
  | null {
  if (!branding) {
    return null;
  }
  const brandName = branding.brandName?.trim();
  const safeBrandName = brandName ? brandName.slice(0, 120) : undefined;
  const safeLogoUrl = sanitizeHeroImageUrl(branding.logoUrl ?? null) ?? undefined;
  const safePrimaryColor = sanitizeHexColor(branding.primaryColor);
  const safeAccentColor = sanitizeHexColor(branding.accentColor);
  const safeSurfaceColor = sanitizeHexColor(branding.surfaceColor);
  if (
    !safeBrandName &&
    !safeLogoUrl &&
    !safePrimaryColor &&
    !safeAccentColor &&
    !safeSurfaceColor
  ) {
    return null;
  }
  return {
    brandName: safeBrandName,
    logoUrl: safeLogoUrl,
    primaryColor: safePrimaryColor ?? undefined,
    accentColor: safeAccentColor ?? undefined,
    surfaceColor: safeSurfaceColor ?? undefined,
  };
}
