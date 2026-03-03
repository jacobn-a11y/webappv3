export interface LinkCandidate {
  url: string;
  field: string;
}

export interface LinkSyntaxIssue {
  field: string;
  url: string;
  code:
    | "unsafe_link_scheme"
    | "unsupported_link_scheme"
    | "malformed_link_url";
  message: string;
}

const MARKDOWN_LINK_REGEX = /\[[^\]]*]\(([^)\s]+(?:\s+["'][^"']*["'])?)\)/g;
const AUTO_LINK_REGEX = /<((?:https?:\/\/|mailto:|tel:)[^>\s]+)>/gi;
const BARE_URL_REGEX = /\b(?:https?:\/\/|mailto:|tel:)[^\s<>()]+/gi;

function cleanUrlToken(rawUrl: string): string {
  let url = rawUrl.trim();
  const firstSpace = url.search(/\s/);
  if (firstSpace > -1) {
    url = url.slice(0, firstSpace);
  }
  return url.replace(/[),.;!?]+$/g, "");
}

function appendMatches(
  output: LinkCandidate[],
  field: string,
  text: string,
  regex: RegExp
): void {
  regex.lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const extracted = cleanUrlToken(match[1] ?? match[0] ?? "");
    if (!extracted) {
      continue;
    }
    output.push({ field, url: extracted });
  }
}

export function collectLinkCandidates(
  parts: Array<{ field: string; text?: string | null }>
): LinkCandidate[] {
  const candidates: LinkCandidate[] = [];
  for (const part of parts) {
    if (!part.text) {
      continue;
    }
    appendMatches(candidates, part.field, part.text, MARKDOWN_LINK_REGEX);
    appendMatches(candidates, part.field, part.text, AUTO_LINK_REGEX);
    appendMatches(candidates, part.field, part.text, BARE_URL_REGEX);
  }

  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = `${item.field}::${item.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function validateLinkSyntax(candidates: LinkCandidate[]): LinkSyntaxIssue[] {
  const issues: LinkSyntaxIssue[] = [];
  const unsafeScheme = /^(?:javascript|data|vbscript|file):/i;
  const validSpecialScheme = /^(?:mailto|tel):/i;

  for (const candidate of candidates) {
    const { field, url } = candidate;
    if (unsafeScheme.test(url)) {
      issues.push({
        field,
        url,
        code: "unsafe_link_scheme",
        message: `Unsafe URL scheme is not allowed: ${url}`,
      });
      continue;
    }

    if (url.startsWith("#") || url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) {
      continue;
    }

    if (validSpecialScheme.test(url)) {
      continue;
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url)) {
      issues.push({
        field,
        url,
        code: "unsupported_link_scheme",
        message: `Unsupported URL scheme in link: ${url}`,
      });
      continue;
    }

    if (/^https?:/i.test(url)) {
      try {
        const parsed = new URL(url);
        if (!parsed.hostname) {
          throw new Error("Missing hostname");
        }
      } catch {
        issues.push({
          field,
          url,
          code: "malformed_link_url",
          message: `Malformed URL in link: ${url}`,
        });
      }
      continue;
    }

    issues.push({
      field,
      url,
      code: "malformed_link_url",
      message: `Link must be absolute (https://...) or a valid relative path: ${url}`,
    });
  }

  return issues;
}
