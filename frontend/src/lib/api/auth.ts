import type { AuthResponse, AuthUser, InviteSummary } from "./types";
import {
  clearAuthState,
  getSessionToken,
  getStoredAuthUser,
  persistAuthState,
  readSupportImpersonationToken,
  request,
  setSupportImpersonationToken,
  subscribeAuthChanges,
} from "./http";

export {
  clearAuthState,
  getStoredAuthUser,
  readSupportImpersonationToken,
  setSupportImpersonationToken,
  subscribeAuthChanges,
};

export async function signupWithPassword(body: {
  email: string;
  password: string;
  name?: string;
  organizationName?: string;
}): Promise<AuthResponse> {
  const response = await request<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
  persistAuthState({ sessionToken: response.sessionToken, user: response.user });
  return response;
}

export async function getSsoAuthorizationUrl(
  screen?: "sign-up" | "sign-in"
): Promise<string> {
  const query =
    screen === "sign-up" ? "?provider=google&screen=sign-up" : "?provider=google";
  const response = await request<{ authorizationUrl: string }>(`/auth/login${query}`);
  return response.authorizationUrl;
}

export async function completeSsoCallback(code: string): Promise<AuthResponse> {
  const response = await request<AuthResponse>(
    `/auth/callback?code=${encodeURIComponent(code)}`
  );
  persistAuthState({ sessionToken: response.sessionToken, user: response.user });
  return response;
}

export async function loginWithPassword(body: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const response = await request<AuthResponse>("/auth/login/password", {
    method: "POST",
    body: JSON.stringify(body),
  });
  persistAuthState({ sessionToken: response.sessionToken, user: response.user });
  return response;
}

export async function getAuthMe(): Promise<{
  user: AuthUser;
  sessionExpiresAt: string;
}> {
  const response = await request<{ user: AuthUser; sessionExpiresAt: string }>(
    "/auth/me"
  );
  const existingToken = getSessionToken();
  if (existingToken) {
    persistAuthState({ sessionToken: existingToken, user: response.user });
  }
  return response;
}

export async function updateAuthMe(body: { name: string }): Promise<{ user: AuthUser }> {
  const response = await request<{ user: AuthUser }>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const existingToken = getSessionToken();
  if (existingToken) {
    persistAuthState({ sessionToken: existingToken, user: response.user });
  }
  return response;
}

export async function logoutSelfService(): Promise<void> {
  try {
    await request<{ success: boolean }>("/auth/logout", {
      method: "POST",
    });
  } finally {
    clearAuthState();
  }
}

export async function getInviteDetails(
  token: string
): Promise<{ invite: InviteSummary }> {
  return request<{ invite: InviteSummary }>(
    `/auth/invites/${encodeURIComponent(token)}`
  );
}

export async function acceptInvite(
  token: string,
  body: {
    password: string;
    name?: string;
  }
): Promise<AuthResponse> {
  const response = await request<AuthResponse>(
    `/auth/invites/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
  persistAuthState({ sessionToken: response.sessionToken, user: response.user });
  return response;
}

export async function createSelfServeCheckout(
  plan: "STARTER" | "PROFESSIONAL" | "ENTERPRISE"
): Promise<{
  checkoutUrl: string;
}> {
  return request<{ checkoutUrl: string }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
}

export async function createSelfServePortal(): Promise<{ portalUrl: string }> {
  return request<{ portalUrl: string }>("/billing/portal", {
    method: "POST",
  });
}
