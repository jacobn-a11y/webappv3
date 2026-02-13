"use client";

import { createContext, useContext } from "react";

export interface SessionUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

export interface OrgMembership {
  id: string;
  organizationId: string;
  organizationName?: string;
}

export interface SessionData {
  user: SessionUser;
  organizationMemberships: OrgMembership[];
  currentOrgId: string | null;
}

const SessionContext = createContext<SessionData | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: SessionData;
  children: React.ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used within SessionProvider");
  return session;
}
