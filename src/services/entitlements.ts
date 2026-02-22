interface EntitlementOverride {
  feature_flags?: string[];
  seat_limit?: number | null;
  usage_caps?: Record<string, number>;
}

interface EntitlementOverrideConfig {
  [environment: string]: EntitlementOverride;
}

interface EntitlementOrgOverrideConfig {
  [organizationId: string]: EntitlementOverride;
}

export function getResolvedEntitlementOverride(
  organizationId: string
): EntitlementOverride {
  const env = process.env.DEPLOY_ENV || process.env.NODE_ENV || "development";
  const envOverride = readEnvOverrides()[env] ?? {};
  const orgOverride = readOrgOverrides()[organizationId] ?? {};

  return {
    feature_flags: dedupe([...(envOverride.feature_flags ?? []), ...(orgOverride.feature_flags ?? [])]),
    seat_limit:
      orgOverride.seat_limit !== undefined
        ? orgOverride.seat_limit
        : envOverride.seat_limit,
    usage_caps: {
      ...(envOverride.usage_caps ?? {}),
      ...(orgOverride.usage_caps ?? {}),
    },
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function readEnvOverrides(): EntitlementOverrideConfig {
  const raw = process.env.ENTITLEMENT_ENV_OVERRIDES_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as EntitlementOverrideConfig;
  } catch {
    return {};
  }
}

function readOrgOverrides(): EntitlementOrgOverrideConfig {
  const raw = process.env.ENTITLEMENT_ORG_OVERRIDES_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as EntitlementOrgOverrideConfig;
  } catch {
    return {};
  }
}
