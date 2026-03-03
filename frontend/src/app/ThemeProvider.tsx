import { useCallback, useEffect, useState } from "react";
import { CONTRAST_KEY, THEME_KEY, type ThemePreference } from "./Sidebar";

export function useTheme() {
  const [highContrast, setHighContrast] = useState(() => {
    try { return localStorage.getItem(CONTRAST_KEY) === "true"; } catch { return false; }
  });
  const [theme, setTheme] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === "light" || stored === "dark" ? stored : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("theme-high-contrast", highContrast);
    document.documentElement.lang = "en";
    try {
      localStorage.setItem(CONTRAST_KEY, String(highContrast));
    } catch {
      // Ignore storage failures in restricted environments.
    }
    return () => {
      document.documentElement.classList.remove("theme-high-contrast");
    };
  }, [highContrast]);

  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", theme === "light");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage failures in restricted environments.
    }
    return () => {
      document.documentElement.classList.remove("theme-light");
    };
  }, [theme]);

  const toggleHighContrast = useCallback(() => {
    setHighContrast((prev) => !prev);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, highContrast, toggleTheme, toggleHighContrast };
}
