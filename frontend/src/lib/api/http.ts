import type { AuthUser } from "./types";

export const BASE_URL = "/api";
const SUPPORT_IMPERSONATION_TOKEN_KEY = "support_impersonation_token";
const APP_SESSION_TOKEN_KEY = "app_session_token";
const APP_AUTH_USER_KEY = "app_auth_user";
const APP_CSRF_TOKEN_KEY = "app_csrf_token";
const AUTH_CHANGED_EVENT = "storyengine-auth-changed";

function emitAuthChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

export function getSupportImpersonationToken(): string | null {
  try {
    return localStorage.getItem(SUPPORT_IMPERSONATION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(APP_SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function readStoredAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(APP_AUTH_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers = buildRequestHeaders(options?.headers);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json();
}

export function buildRequestHeaders(existing?: HeadersInit): Headers {
  const headers = new Headers(existing ?? {});
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  const sessionToken = getSessionToken();
  if (sessionToken) {
    headers.set("x-session-token", sessionToken);
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set("x-csrf-token", csrfToken);
    }
  }
  const supportToken = getSupportImpersonationToken();
  if (supportToken) {
    headers.set("x-support-impersonation-token", supportToken);
  }
  return headers;
}

export function setSupportImpersonationToken(token: string | null): void {
  try {
    if (!token) {
      localStorage.removeItem(SUPPORT_IMPERSONATION_TOKEN_KEY);
      return;
    }
    localStorage.setItem(SUPPORT_IMPERSONATION_TOKEN_KEY, token);
  } catch {
    // Ignore storage errors in restricted environments.
  }
}

export function readSupportImpersonationToken(): string | null {
  return getSupportImpersonationToken();
}

export function getCsrfToken(): string | null {
  try {
    return localStorage.getItem(APP_CSRF_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setCsrfToken(token: string | null): void {
  try {
    if (!token) {
      localStorage.removeItem(APP_CSRF_TOKEN_KEY);
      return;
    }
    localStorage.setItem(APP_CSRF_TOKEN_KEY, token);
  } catch {
    // Ignore storage errors
  }
}

export function persistAuthState(payload: {
  sessionToken: string;
  user: AuthUser;
  csrfToken?: string;
}): void {
  try {
    localStorage.setItem(APP_SESSION_TOKEN_KEY, payload.sessionToken);
    localStorage.setItem(APP_AUTH_USER_KEY, JSON.stringify(payload.user));
    if (payload.csrfToken) {
      setCsrfToken(payload.csrfToken);
    }
    emitAuthChanged();
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function clearAuthState(): void {
  try {
    localStorage.removeItem(APP_SESSION_TOKEN_KEY);
    localStorage.removeItem(APP_AUTH_USER_KEY);
    localStorage.removeItem(SUPPORT_IMPERSONATION_TOKEN_KEY);
    localStorage.removeItem(APP_CSRF_TOKEN_KEY);
    emitAuthChanged();
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function getStoredAuthUser(): AuthUser | null {
  return readStoredAuthUser();
}

export function subscribeAuthChanges(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(AUTH_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AUTH_CHANGED_EVENT, listener);
}
