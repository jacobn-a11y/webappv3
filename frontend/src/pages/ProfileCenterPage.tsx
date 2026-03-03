import { useEffect, useState } from "react";
import { getAuthMe, updateAuthMe } from "../lib/api";
import { useToast } from "../components/Toast";
import { useI18n, type LocaleCode } from "../i18n";

interface UserPreferenceState {
  default_story_mode: "anonymous" | "named";
  auto_open_preview: boolean;
  email_notifications: boolean;
  compact_tables: boolean;
  locale: LocaleCode;
}

const PREFS_KEY = "user_preferences_v1";

const DEFAULT_PREFS: UserPreferenceState = {
  default_story_mode: "anonymous",
  auto_open_preview: true,
  email_notifications: true,
  compact_tables: false,
  locale: "en-US",
};

function loadPrefs(): UserPreferenceState {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<UserPreferenceState>;
    return {
      default_story_mode:
        parsed.default_story_mode === "named" ? "named" : "anonymous",
      auto_open_preview:
        typeof parsed.auto_open_preview === "boolean"
          ? parsed.auto_open_preview
          : true,
      email_notifications:
        typeof parsed.email_notifications === "boolean"
          ? parsed.email_notifications
          : true,
      compact_tables:
        typeof parsed.compact_tables === "boolean" ? parsed.compact_tables : false,
      locale: parsed.locale === "es-ES" ? "es-ES" : "en-US",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function ProfileCenterPage() {
  const { locale, setLocale, t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [prefs, setPrefs] = useState<UserPreferenceState>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    setPrefs({
      ...loadPrefs(),
      locale,
    });
    getAuthMe()
      .then((res) => {
        setName(res.user.name ?? "");
        setEmail(res.user.email);
        setRole(res.user.role);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      })
      .finally(() => setLoading(false));
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    setError(null);
    try {
      await updateAuthMe({ name: name.trim() || email.split("@")[0] || "User" });
      showToast(t("profile.saved.profile", "Profile updated"), "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const savePreferences = async () => {
    setSavingPrefs(true);
    setError(null);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      setLocale(prefs.locale);
      showToast(t("profile.saved.preferences", "Preferences saved"), "success");
    } catch {
      setError("Failed to save preferences in this browser.");
    } finally {
      setSavingPrefs(false);
    }
  };

  if (loading) {
    return (
      <div className="state-view" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="state-view__title">{t("profile.loading", "Loading profile...")}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">{t("profile.title", "Profile Center")}</h1>
          <p className="page__subtitle">
            {t(
              "profile.subtitle",
              "Manage your account identity and personal workflow preferences."
            )}
          </p>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">{t("profile.account.title", "Account Profile")}</div>
        </div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-group__label">
              {t("profile.account.display_name", "Display Name")}
            </label>
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="form-group">
            <label className="form-group__label">{t("profile.account.email", "Email")}</label>
            <input className="form-input" value={email} readOnly />
          </div>
          <div className="form-group">
            <label className="form-group__label">{t("profile.account.role", "Role")}</label>
            <input className="form-input" value={role} readOnly />
          </div>
        </div>
        <div className="form-actions-end">
          <button className="btn btn--primary" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? "Saving..." : t("profile.account.save", "Save Profile")}
          </button>
        </div>
      </div>

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">{t("profile.prefs.title", "User Preferences")}</div>
        </div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-group__label">
              {t("profile.prefs.story_mode", "Default Story Mode")}
            </label>
            <select
              className="form-select"
              value={prefs.default_story_mode}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  default_story_mode:
                    e.target.value === "named" ? "named" : "anonymous",
                }))
              }
            >
              <option value="anonymous">
                {t("profile.prefs.story_mode.anonymous", "Anonymous by default")}
              </option>
              <option value="named">
                {t("profile.prefs.story_mode.named", "Named by default")}
              </option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-group__label">
              {t("profile.prefs.preview", "Open Preview After Generation")}
            </label>
            <select
              className="form-select"
              value={prefs.auto_open_preview ? "yes" : "no"}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  auto_open_preview: e.target.value === "yes",
                }))
              }
            >
              <option value="yes">{t("profile.prefs.yes", "Yes")}</option>
              <option value="no">{t("profile.prefs.no", "No")}</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-group__label">
              {t("profile.prefs.email_notifications", "Email Notifications")}
            </label>
            <select
              className="form-select"
              value={prefs.email_notifications ? "enabled" : "disabled"}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  email_notifications: e.target.value === "enabled",
                }))
              }
            >
              <option value="enabled">{t("profile.prefs.enabled", "Enabled")}</option>
              <option value="disabled">{t("profile.prefs.disabled", "Disabled")}</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-group__label">
              {t("profile.prefs.table_density", "Compact Table Density")}
            </label>
            <select
              className="form-select"
              value={prefs.compact_tables ? "compact" : "comfortable"}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  compact_tables: e.target.value === "compact",
                }))
              }
            >
              <option value="comfortable">
                {t("profile.prefs.table_density.comfortable", "Comfortable")}
              </option>
              <option value="compact">
                {t("profile.prefs.table_density.compact", "Compact")}
              </option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-group__label">{t("profile.prefs.locale", "Language")}</label>
            <select
              className="form-select"
              value={prefs.locale}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  locale: e.target.value === "es-ES" ? "es-ES" : "en-US",
                }))
              }
            >
              <option value="en-US">
                {t("profile.prefs.locale.en-US", "English (US)")}
              </option>
              <option value="es-ES">
                {t("profile.prefs.locale.es-ES", "Spanish")}
              </option>
            </select>
          </div>
        </div>
        <div className="form-actions-end">
          <button className="btn btn--primary" onClick={savePreferences} disabled={savingPrefs}>
            {savingPrefs ? "Saving..." : t("profile.prefs.save", "Save Preferences")}
          </button>
        </div>
      </div>
    </div>
  );
}
