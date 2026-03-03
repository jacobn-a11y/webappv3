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

/**
 * Strip all HTML tags from a string. Use for sanitizing content
 * that will be placed inside style tags or other sensitive contexts.
 */
export function stripHtmlTags(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}
