import { useEffect, useState } from "react";
import {
  getStoryContextSettings,
  updateStoryContextSettings,
  type StoryContextSettings,
} from "../lib/api";
import {
  STORY_FORMAT_LABELS,
  STORY_LENGTH_LABELS,
  STORY_OUTLINE_LABELS,
  STORY_TYPE_INPUT_LABELS,
} from "../types/taxonomy";

const EMPTY_SETTINGS: StoryContextSettings = {
  company_overview: "",
  products: [],
  target_personas: [],
  target_industries: [],
  differentiators: [],
  proof_points: [],
  banned_claims: [],
  writing_style_guide: "",
  approved_terminology: [],
  default_story_length: "MEDIUM",
  default_story_outline: "CHRONOLOGICAL_JOURNEY",
  default_story_format: null,
  default_story_type: "FULL_ACCOUNT_JOURNEY",
};

function splitCsv(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AdminStoryContextPage() {
  const [settings, setSettings] = useState<StoryContextSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [productsCsv, setProductsCsv] = useState("");
  const [personasCsv, setPersonasCsv] = useState("");
  const [industriesCsv, setIndustriesCsv] = useState("");
  const [differentiatorsCsv, setDifferentiatorsCsv] = useState("");
  const [proofPointsCsv, setProofPointsCsv] = useState("");
  const [bannedClaimsCsv, setBannedClaimsCsv] = useState("");
  const [terminologyCsv, setTerminologyCsv] = useState("");

  useEffect(() => {
    getStoryContextSettings()
      .then((data) => {
        setSettings(data);
        setProductsCsv(data.products.join(", "));
        setPersonasCsv(data.target_personas.join(", "));
        setIndustriesCsv(data.target_industries.join(", "));
        setDifferentiatorsCsv(data.differentiators.join(", "));
        setProofPointsCsv(data.proof_points.join(", "));
        setBannedClaimsCsv(data.banned_claims.join(", "));
        setTerminologyCsv(data.approved_terminology.join(", "));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload: StoryContextSettings = {
      ...settings,
      products: splitCsv(productsCsv),
      target_personas: splitCsv(personasCsv),
      target_industries: splitCsv(industriesCsv),
      differentiators: splitCsv(differentiatorsCsv),
      proof_points: splitCsv(proofPointsCsv),
      banned_claims: splitCsv(bannedClaimsCsv),
      approved_terminology: splitCsv(terminologyCsv),
    };
    try {
      await updateStoryContextSettings(payload);
      setNotice("Story context saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="admin-story-context__page">Loading story context...</div>;
  }

  return (
    <div className="admin-story-context__page">
      <header>
        <h1 className="admin-story-context__title">Story Context</h1>
        <p className="admin-story-context__subtitle">
          Configure company/product context and default prompt settings used by story generation.
        </p>
      </header>

      {error && <div className="admin-story-context__error">{error}</div>}
      {notice && <div className="admin-story-context__notice">{notice}</div>}

      <section className="admin-story-context__card">
        <h2>Company Narrative Context</h2>
        <label>
          Company Overview
          <textarea
            value={settings.company_overview}
            onChange={(e) =>
              setSettings((p) => ({ ...p, company_overview: e.target.value }))
            }
            rows={5}
          />
        </label>
        <label>
          Products (comma-separated)
          <input value={productsCsv} onChange={(e) => setProductsCsv(e.target.value)} />
        </label>
        <label>
          Target Personas (comma-separated)
          <input value={personasCsv} onChange={(e) => setPersonasCsv(e.target.value)} />
        </label>
        <label>
          Target Industries (comma-separated)
          <input value={industriesCsv} onChange={(e) => setIndustriesCsv(e.target.value)} />
        </label>
        <label>
          Differentiators (comma-separated)
          <input
            value={differentiatorsCsv}
            onChange={(e) => setDifferentiatorsCsv(e.target.value)}
          />
        </label>
        <label>
          Proof Points (comma-separated)
          <input value={proofPointsCsv} onChange={(e) => setProofPointsCsv(e.target.value)} />
        </label>
        <label>
          Banned Claims (comma-separated)
          <input value={bannedClaimsCsv} onChange={(e) => setBannedClaimsCsv(e.target.value)} />
        </label>
        <label>
          Approved Terminology (comma-separated)
          <input value={terminologyCsv} onChange={(e) => setTerminologyCsv(e.target.value)} />
        </label>
        <label>
          Writing Style Guide
          <textarea
            value={settings.writing_style_guide}
            onChange={(e) =>
              setSettings((p) => ({ ...p, writing_style_guide: e.target.value }))
            }
            rows={4}
          />
        </label>
      </section>

      <section className="admin-story-context__card">
        <h2>Default Generation Settings</h2>
        <label>
          Default Story Length
          <select
            value={settings.default_story_length}
            onChange={(e) =>
              setSettings((p) => ({
                ...p,
                default_story_length: e.target.value as StoryContextSettings["default_story_length"],
              }))
            }
          >
            {Object.entries(STORY_LENGTH_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Default Story Outline
          <select
            value={settings.default_story_outline}
            onChange={(e) =>
              setSettings((p) => ({
                ...p,
                default_story_outline: e.target.value as StoryContextSettings["default_story_outline"],
              }))
            }
          >
            {Object.entries(STORY_OUTLINE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Default Story Format
          <select
            value={settings.default_story_format ?? ""}
            onChange={(e) =>
              setSettings((p) => ({
                ...p,
                default_story_format: (e.target.value || null) as StoryContextSettings["default_story_format"],
              }))
            }
          >
            <option value="">Auto</option>
            {Object.entries(STORY_FORMAT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Default Story Type
          <select
            value={settings.default_story_type}
            onChange={(e) =>
              setSettings((p) => ({
                ...p,
                default_story_type: e.target.value as StoryContextSettings["default_story_type"],
              }))
            }
          >
            {Object.entries(STORY_TYPE_INPUT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="admin-story-context__actions">
        <button className="btn btn--primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
