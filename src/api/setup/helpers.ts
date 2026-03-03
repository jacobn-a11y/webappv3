interface ParsedGongKeyBundle {
  accessKey: string;
  accessKeySecret: string;
}

export function parseGongKeyBundle(input: string): ParsedGongKeyBundle | null {
  const value = String(input ?? "").trim();
  if (!value) return null;

  const parsePair = (raw: string): ParsedGongKeyBundle | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const separator = trimmed.includes(":")
      ? ":"
      : trimmed.includes("|")
        ? "|"
        : null;
    if (!separator) return null;
    const idx = trimmed.indexOf(separator);
    const accessKey = trimmed.slice(0, idx).trim();
    const accessKeySecret = trimmed.slice(idx + 1).trim();
    if (!accessKey || !accessKeySecret) return null;
    return { accessKey, accessKeySecret };
  };

  if (value.toLowerCase().startsWith("basic ")) {
    const payload = value.slice(6).trim();
    try {
      const decoded = Buffer.from(payload, "base64").toString("utf8");
      const parsed = parsePair(decoded);
      if (parsed) return parsed;
    } catch {
      return null;
    }
  }

  if (value.startsWith("{") && value.endsWith("}")) {
    try {
      const parsedJson = JSON.parse(value) as {
        accessKey?: string;
        access_key?: string;
        key?: string;
        accessKeySecret?: string;
        access_key_secret?: string;
        secret?: string;
      };
      const accessKey =
        parsedJson.accessKey ?? parsedJson.access_key ?? parsedJson.key ?? "";
      const accessKeySecret =
        parsedJson.accessKeySecret ??
        parsedJson.access_key_secret ??
        parsedJson.secret ??
        "";
      if (String(accessKey).trim() && String(accessKeySecret).trim()) {
        return {
          accessKey: String(accessKey).trim(),
          accessKeySecret: String(accessKeySecret).trim(),
        };
      }
    } catch {
      return null;
    }
  }

  return parsePair(value);
}

export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
