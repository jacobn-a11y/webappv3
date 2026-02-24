/**
 * Gong account extraction and matching helpers.
 *
 * This mirrors the account derivation behavior used by the Gong Transcript
 * Exporter desktop app so setup-time account indexing and ingestion filtering
 * behave consistently.
 */

const ACCOUNT_FIELD_NAMES = new Set([
  "name",
  "account",
  "accountname",
  "account_name",
  "company",
  "companyname",
  "company_name",
  "organization",
  "organization_name",
  "org_name",
  "account id",
  "account_name__c",
  "company_name__c",
]);

const EXCLUDED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const TITLE_PREFIX_PATTERN =
  /^(?:call|meeting|demo|discovery|intro|conversation|sync|follow(?:-|\s)?up)\s+with\s+/i;

const GENERIC_TITLE_TOKENS = new Set([
  "call",
  "meeting",
  "demo",
  "discovery",
  "conversation",
  "sync",
  "followup",
  "follow",
  "intro",
  "api",
  "qa",
  "q&a",
  "zoom",
  "google",
  "meet",
  "teams",
  "recording",
  "outbound",
  "inbound",
  "test",
  "inc",
  "llc",
  "ltd",
  "corp",
  "co",
  "company",
]);

const COMPANY_HINT_TOKENS = new Set([
  "inc",
  "llc",
  "ltd",
  "group",
  "partners",
  "partner",
  "assoc",
  "associates",
  "architects",
  "architecture",
  "engineering",
  "design",
  "consulting",
  "consultants",
  "technologies",
  "technology",
  "software",
  "systems",
  "solutions",
  "holdings",
  "capital",
  "ventures",
  "labs",
  "studio",
  "studios",
  "agency",
  "corp",
  "corporation",
  "company",
]);

interface GongField {
  name?: string;
  value?: string;
}

interface GongContextObject {
  objectType?: string;
  fields?: GongField[];
}

interface GongContext {
  objects?: GongContextObject[];
}

export interface GongPartyLike {
  affiliation?: string;
  emailAddress?: string;
  email?: string;
  name?: string;
  displayName?: string;
  context?: GongContext[];
}

interface GongCallMetaLike {
  title?: string;
  parties?: GongPartyLike[];
}

export interface GongCallLike {
  title?: string;
  parties?: GongPartyLike[];
  metaData?: GongCallMetaLike;
}

function normalizeAccountName(input: string): string {
  if (!input) return "";
  return String(input)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[-_.\s]+|[-_.\s]+$/g, "");
}

export function normalizeGongAccountMatch(input: string): string {
  return normalizeAccountName(input)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toTitleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function partyEmailAddress(party: GongPartyLike): string {
  return party.emailAddress ?? party.email ?? "";
}

function partyDisplayName(party: GongPartyLike): string {
  return party.name ?? party.displayName ?? "";
}

function classifyAffiliation(affiliation?: string): "INTERNAL" | "EXTERNAL" | "UNKNOWN" {
  const value = String(affiliation ?? "").toLowerCase();
  if (!value) return "UNKNOWN";
  if (
    value.includes("external") ||
    value.includes("customer") ||
    value.includes("client") ||
    value.includes("prospect") ||
    value.includes("partner")
  ) {
    return "EXTERNAL";
  }
  if (
    value.includes("internal") ||
    value.includes("company") ||
    value.includes("employee") ||
    value.includes("organizer") ||
    value.includes("host")
  ) {
    return "INTERNAL";
  }
  return "UNKNOWN";
}

function companyFromEmail(email: string): string {
  if (!email || !email.includes("@")) return "";
  const domain = email.split("@")[1] ?? "";
  if (EXCLUDED_EMAIL_DOMAINS.has(domain.toLowerCase())) return "";
  const root = domain.split(".")[0] ?? "";
  const normalized = normalizeAccountName(root.replace(/[-_]+/g, " "));
  if (!normalized) return "";
  return toTitleCase(normalized);
}

function emailDomain(email: string): string {
  if (!email || !email.includes("@")) return "";
  return String(email).split("@")[1]?.trim().toLowerCase() ?? "";
}

function unwrapGongCall(call: GongCallLike): { title: string; parties: GongPartyLike[] } {
  const row = call && typeof call === "object" ? call : {};
  const metaData =
    row.metaData && typeof row.metaData === "object" ? row.metaData : row;
  const parties = Array.isArray(row.parties)
    ? row.parties
    : Array.isArray(metaData.parties)
      ? metaData.parties
      : [];
  return {
    title: String(metaData.title ?? row.title ?? ""),
    parties,
  };
}

function looksLikePersonName(value: string): boolean {
  const raw = normalizeAccountName(value);
  if (!raw) return false;
  const parts = raw.split(" ").filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  if (!parts.every((part) => /^[A-Za-z'.-]+$/.test(part))) return false;
  const lower = parts.map((part) => part.toLowerCase());
  if (lower.some((token) => COMPANY_HINT_TOKENS.has(token))) return false;
  return parts.every((part) => /^[A-Z][a-z'.-]+$/.test(part));
}

function maybeMeaningfulTitleCandidate(value: string): string {
  const normalized = normalizeAccountName(value);
  if (!normalized) return "";
  if (looksLikePersonName(normalized)) return "";
  const simplified = normalized
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!simplified) return "";
  const words = simplified.split(" ").filter(Boolean);
  if (words.length === 0) return "";
  if (words.every((word) => GENERIC_TITLE_TOKENS.has(word))) return "";
  if (normalized.length < 2 || normalized.length > 90) return "";
  return normalized;
}

function titleCandidates(title: string): string[] {
  const raw = String(title ?? "").trim();
  if (!raw) return [];
  const candidates = new Set<string>();
  const cleaned = raw
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]+\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned.replace(TITLE_PREFIX_PATTERN, "");
  const firstSegment = base.split(/\s[-|:]\s| – | — /)[0] || "";
  const normalized = maybeMeaningfulTitleCandidate(firstSegment);
  if (normalized) candidates.add(normalized);
  return Array.from(candidates);
}

function explodeCrossCandidate(candidate: string): string[] {
  const raw = normalizeAccountName(candidate);
  if (!raw) return [];
  const parts = raw
    .split(/\s(?:x|×|vs)\s|\s\/\s|,\s+/i)
    .map((part) => maybeMeaningfulTitleCandidate(part))
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}

function collectFromContext(party: GongPartyLike): string[] {
  const found: string[] = [];
  for (const ctx of party.context ?? []) {
    for (const obj of ctx.objects ?? []) {
      const objectType = (obj.objectType ?? "").toLowerCase();
      if (
        !objectType.includes("account") &&
        !objectType.includes("company") &&
        !objectType.includes("organization")
      ) {
        continue;
      }
      for (const field of obj.fields ?? []) {
        const fieldName = (field.name ?? "").toLowerCase();
        const value = normalizeAccountName(field.value ?? "");
        if (!value) continue;
        if (
          ACCOUNT_FIELD_NAMES.has(fieldName) ||
          fieldName.includes("account") ||
          fieldName.includes("company")
        ) {
          found.push(value);
        }
      }
    }
  }
  return found;
}

function collectInternalDomains(parties: GongPartyLike[]): Set<string> {
  const domains = new Set<string>();
  for (const party of parties) {
    if (classifyAffiliation(party.affiliation) !== "INTERNAL") continue;
    const domain = emailDomain(partyEmailAddress(party));
    if (domain) domains.add(domain);
  }
  return domains;
}

function internalDomainRootAliases(internalDomains: Set<string>): Set<string> {
  const roots = new Set<string>();
  for (const domain of internalDomains) {
    const root = String(domain).split(".")[0] ?? "";
    const normalized = root.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!normalized) continue;
    roots.add(normalized);
    const stripped = normalized.replace(/(app|hq|inc|corp|llc|co|company|team)$/i, "");
    if (stripped && stripped.length >= 3) roots.add(stripped);
  }
  return roots;
}

function pushCandidate(
  map: Map<string, { name: string; score: number; mentions: number }>,
  name: string,
  score: number
): void {
  const normalizedName = normalizeAccountName(name);
  if (!normalizedName) return;
  const key = normalizedName.toLowerCase();
  const existing = map.get(key);
  if (existing) {
    existing.score += score;
    existing.mentions += 1;
    return;
  }
  map.set(key, {
    name: normalizedName,
    score,
    mentions: 1,
  });
}

export function extractGongCallAccountNames(call: GongCallLike): string[] {
  const { title, parties } = unwrapGongCall(call);
  const internalDomains = collectInternalDomains(parties);
  const internalRoots = internalDomainRootAliases(internalDomains);
  const internalCompanyNames = new Set<string>();
  const preferred = new Map<string, { name: string; score: number; mentions: number }>();
  const fallback = new Map<string, { name: string; score: number; mentions: number }>();

  for (const party of parties) {
    const affiliation = classifyAffiliation(party.affiliation);
    const domain = emailDomain(partyEmailAddress(party));
    const domainIsInternal = domain ? internalDomains.has(domain) : false;
    const isExplicitExternal = affiliation === "EXTERNAL";
    const isLikelyInternal = affiliation === "INTERNAL" || (!isExplicitExternal && domainIsInternal);

    if (isLikelyInternal) {
      const internalCompany = companyFromEmail(partyEmailAddress(party));
      if (internalCompany) internalCompanyNames.add(internalCompany.toLowerCase());
    }

    for (const contextName of collectFromContext(party)) {
      pushCandidate(fallback, contextName, 3);
      pushCandidate(preferred, contextName, isExplicitExternal ? 6 : isLikelyInternal ? 2 : 4);
    }

    const emailCompany = companyFromEmail(partyEmailAddress(party));
    if (emailCompany) {
      pushCandidate(fallback, emailCompany, 1);
      if (!isLikelyInternal) {
        pushCandidate(preferred, emailCompany, isExplicitExternal ? 3 : 1);
      }
    }
  }

  for (const candidate of titleCandidates(title)) {
    pushCandidate(fallback, candidate, 2);
    pushCandidate(preferred, candidate, 2);
    for (const exploded of explodeCrossCandidate(candidate)) {
      pushCandidate(fallback, exploded, 2);
      pushCandidate(preferred, exploded, 2);
    }
  }

  const source = preferred.size > 0 ? preferred : fallback;
  const candidates = Array.from(source.values());
  const hasExternalAlternative = candidates.some(
    (row) => !internalCompanyNames.has(row.name.toLowerCase())
  );

  const filtered = hasExternalAlternative
    ? candidates.filter((row) => {
        const lower = row.name.toLowerCase();
        const normalized = normalizeGongAccountMatch(row.name);
        if (internalCompanyNames.has(lower)) return false;
        for (const internalName of internalCompanyNames) {
          if (lower === internalName) return false;
          if (
            lower.startsWith(`${internalName} x `) ||
            lower.endsWith(` x ${internalName}`) ||
            lower.startsWith(`${internalName} / `) ||
            lower.endsWith(` / ${internalName}`)
          ) {
            return false;
          }
        }
        for (const root of internalRoots) {
          if (!root) continue;
          if (normalized === root || normalized.startsWith(root) || normalized.endsWith(root)) {
            return false;
          }
        }
        return true;
      })
    : candidates;

  return filtered
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.mentions !== a.mentions) return b.mentions - a.mentions;
      return a.name.localeCompare(b.name);
    })
    .map((row) => row.name);
}

export function buildGongAccountCounts(
  calls: GongCallLike[]
): Array<{ name: string; count: number }> {
  const counts = new Map<string, { name: string; count: number }>();
  for (const call of calls) {
    for (const name of extractGongCallAccountNames(call)) {
      const key = name.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { name, count: 1 });
      }
    }
  }
  return Array.from(counts.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });
}

export function gongCallMatchesSelectedAccounts(
  call: GongCallLike,
  selectedAccountNames: string[]
): boolean {
  if (!selectedAccountNames.length) return true;
  const targets = selectedAccountNames
    .map((name) => normalizeGongAccountMatch(name))
    .filter(Boolean);
  if (!targets.length) return true;

  const accounts = extractGongCallAccountNames(call);
  for (const accountName of accounts) {
    const normalized = normalizeGongAccountMatch(accountName);
    if (!normalized) continue;
    for (const target of targets) {
      if (normalized.includes(target) || target.includes(normalized)) return true;
    }
  }

  const { title, parties } = unwrapGongCall(call);
  const normalizedTitle = normalizeGongAccountMatch(title);
  if (normalizedTitle) {
    for (const target of targets) {
      if (normalizedTitle.includes(target) || target.includes(normalizedTitle)) {
        return true;
      }
    }
  }

  for (const party of parties) {
    const participantName = normalizeGongAccountMatch(partyDisplayName(party));
    const participantEmail = normalizeGongAccountMatch(partyEmailAddress(party));
    for (const target of targets) {
      if (
        (participantName && (participantName.includes(target) || target.includes(participantName))) ||
        (participantEmail && participantEmail.includes(target))
      ) {
        return true;
      }
    }
  }

  return false;
}

