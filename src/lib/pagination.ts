export const PAGINATION_LIMITS = {
  LIST_DEFAULT: 100,
  LIST_MAX: 200,
  INTEGRATION_DEFAULT: 100,
  INTEGRATION_MAX: 500,
  SEARCH_DEFAULT: 20,
  SEARCH_MAX: 50,
  EXPORT_DEFAULT: 5000,
  EXPORT_MAX: 10000,
} as const;

export function parseBoundedLimit(
  value: unknown,
  defaults: { fallback: number; min?: number; max: number }
): number {
  const min = defaults.min ?? 1;
  const parsed = Number(value ?? defaults.fallback);
  if (!Number.isFinite(parsed)) {
    return defaults.fallback;
  }
  return Math.max(min, Math.min(defaults.max, Math.floor(parsed)));
}
