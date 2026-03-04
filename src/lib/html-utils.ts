/**
 * Shared HTML escaping utilities.
 * Use these whenever rendering user/API content in HTML context.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

export function escapeAttr(str: string): string {
  return escapeHtml(str);
}

/** Inline script for browser context (chatbot embed). Matches escapeHtml logic. */
export const ESCAPE_HTML_SCRIPT =
  "function escapeHtml(str){if(!str)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}function escapeAttr(str){return escapeHtml(str);}";

/**
 * Strip all HTML tags from a string. Use for sanitizing content
 * that will be placed inside style tags or other sensitive contexts.
 */
export function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}
