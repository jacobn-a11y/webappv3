import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { enUS } from "./messages/en-US";
import { esES } from "./messages/es-ES";

export type LocaleCode = "en-US" | "es-ES";

const LOCALE_STORAGE_KEY = "storyengine_locale";

const catalogs: Record<LocaleCode, Record<string, string>> = {
  "en-US": enUS,
  "es-ES": esES,
};

interface I18nContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLocale(): LocaleCode {
  if (typeof window === "undefined") {
    return "en-US";
  }
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === "en-US" || stored === "es-ES") {
    return stored;
  }
  const browserLocale = window.navigator.language;
  if (browserLocale === "es-ES" || browserLocale.startsWith("es-")) {
    return "es-ES";
  }
  return "en-US";
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<LocaleCode>(getInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // no-op in restricted environments
    }
  }, [locale]);

  const setLocale = useCallback((nextLocale: LocaleCode) => {
    setLocaleState(nextLocale);
  }, []);

  const t = useCallback(
    (key: string, fallback?: string): string => {
      const catalog = catalogs[locale] ?? catalogs["en-US"];
      return catalog[key] ?? fallback ?? key;
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}
