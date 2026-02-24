interface ValidateWebhookTimestampOptions {
  provider: string;
  timestamp: unknown;
  required: boolean;
  now?: Date;
}

interface ValidateWebhookTimestampResult {
  ok: boolean;
  reason: "timestamp_missing" | "timestamp_invalid" | "timestamp_out_of_window" | null;
  observedAt: Date | null;
}

export function readHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  key: string
): string | null {
  const raw = headers[key];
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "string" && first.trim() ? first.trim() : null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function pickFirstHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = readHeaderValue(headers, key.toLowerCase());
    if (value) return value;
  }
  return null;
}

export function validateWebhookTimestamp(
  options: ValidateWebhookTimestampOptions
): ValidateWebhookTimestampResult {
  const observedAt = parseWebhookTimestamp(options.timestamp);
  if (!observedAt) {
    return {
      ok: !options.required,
      reason: options.required ? "timestamp_missing" : null,
      observedAt: null,
    };
  }

  const now = options.now ?? new Date();
  const deltaMs = Math.abs(now.getTime() - observedAt.getTime());
  const windowSeconds = resolveReplayWindowSeconds();
  const withinWindow = deltaMs <= windowSeconds * 1000;

  return {
    ok: withinWindow,
    reason: withinWindow ? null : "timestamp_out_of_window",
    observedAt,
  };
}

function parseWebhookTimestamp(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const asMillis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(asMillis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    const asMillis = parsed > 10_000_000_000 ? parsed : parsed * 1000;
    const date = new Date(asMillis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveReplayWindowSeconds(): number {
  const raw = process.env.WEBHOOK_REPLAY_WINDOW_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 300;
  }
  return parsed;
}
