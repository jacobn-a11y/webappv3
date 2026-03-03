import { useEffect, useState } from "react";
import {
  clearAuthState,
  getAuthMe,
  getStoredAuthUser,
  logoutSelfService,
  subscribeAuthChanges,
  type AuthUser,
} from "../lib/api";

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(getStoredAuthUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sync = () => setUser(getStoredAuthUser());
    const unsubscribe = subscribeAuthChanges(sync);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const existing = getStoredAuthUser();
    if (!existing) {
      setLoading(false);
      return;
    }
    getAuthMe()
      .then((res) => setUser(res.user))
      .catch(() => {
        clearAuthState();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await logoutSelfService();
    setUser(null);
  };

  return { user, loading, handleLogout };
}
