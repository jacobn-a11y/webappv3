const DEFAULT_PUBLIC_APP_URL = "http://localhost:5173";

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getPublicAppUrl(): string {
  const configured = process.env.FRONTEND_URL ?? process.env.APP_URL;
  if (configured && configured.trim().length > 0) {
    return stripTrailingSlash(configured.trim());
  }
  return DEFAULT_PUBLIC_APP_URL;
}

export function buildPublicAppUrl(pathname: string): string {
  const base = getPublicAppUrl();
  if (!pathname) return base;
  if (pathname.startsWith("/")) return `${base}${pathname}`;
  return `${base}/${pathname}`;
}
