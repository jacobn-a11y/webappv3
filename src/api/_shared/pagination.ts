export interface PaginationParams {
  page: number;
  limit: number;
}

export function parsePaginationParams(
  query: { page?: unknown; limit?: unknown },
  defaults: { page?: number; limit?: number; maxLimit?: number } = {}
): PaginationParams {
  const defaultPage = defaults.page ?? 1;
  const defaultLimit = defaults.limit ?? 50;
  const maxLimit = defaults.maxLimit ?? 200;

  const read = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0];
    }
    return undefined;
  };

  const rawPage = Number.parseInt(read(query.page) ?? `${defaultPage}`, 10);
  const rawLimit = Number.parseInt(read(query.limit) ?? `${defaultLimit}`, 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : defaultPage;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, maxLimit)
      : defaultLimit;

  return { page, limit };
}
