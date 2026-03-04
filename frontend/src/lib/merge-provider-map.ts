export function mapRecordingProvider(slug: string):
  | "GONG"
  | "CHORUS"
  | "ZOOM"
  | "GOOGLE_MEET"
  | "TEAMS"
  | "FIREFLIES"
  | "DIALPAD"
  | "AIRCALL"
  | "RINGCENTRAL"
  | "SALESLOFT"
  | "OUTREACH"
  | "OTHER" {
  const normalized = slug.trim().toLowerCase();
  if (normalized.includes("gong")) return "GONG";
  if (normalized.includes("chorus")) return "CHORUS";
  if (normalized.includes("zoom")) return "ZOOM";
  if (normalized.includes("google")) return "GOOGLE_MEET";
  if (normalized.includes("teams") || normalized.includes("microsoft")) return "TEAMS";
  if (normalized.includes("fireflies")) return "FIREFLIES";
  if (normalized.includes("dialpad")) return "DIALPAD";
  if (normalized.includes("aircall")) return "AIRCALL";
  if (normalized.includes("ringcentral")) return "RINGCENTRAL";
  if (normalized.includes("salesloft")) return "SALESLOFT";
  if (normalized.includes("outreach")) return "OUTREACH";
  return "OTHER";
}

export function mapCrmProvider(slug: string): "SALESFORCE" | "HUBSPOT" {
  return slug.toLowerCase().includes("salesforce") ? "SALESFORCE" : "HUBSPOT";
}
