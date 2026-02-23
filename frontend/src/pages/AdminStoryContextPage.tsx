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
import { useToast } from "../components/Toast";

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
  const { showToast } = useToast();

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
      showToast("Story context saved", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="state-view" role="status" aria-live="polite"><div className="spinner" /><div className="state-view__title">Loading story context...</div></div>;
  }

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-text">
          <h1 className="page__title">Story Context</h1>
          <p className="page__subtitle">Configure company/product context and default prompt settings used by story generation.</p>
        </div>
      </div>

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Company Narrative Context</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="form-group">
            <label className="form-group__label">Company Overview</label>
            <textarea
              className="form-textarea"
              value={settings.company_overview}
              onChange={(e) =>
                setSettings((p) => ({ ...p, company_overview: e.target.value }))
              }
              rows={5}
              placeholder="Describe your company, mission, and value proposition..."
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="form-group">
              <label className="form-group__label">Products</label>
              <input className="form-input" value={productsCsv} onChange={(e) => setProductsCsv(e.target.value)} placeholder="Product A, Product B, ..." />
              <div className="form-group__hint">Comma-separated list</div>
            </div>
            <div className="form-group">
              <label className="form-group__label">Target Personas</label>
              <input className="form-input" value={personasCsv} onChange={(e) => setPersonasCsv(e.target.value)} placeholder="VP Sales, CRO, ..." />
              <div className="form-group__hint">Comma-separated list</div>
            </div>
            <div className="form-group">
              <label className="form-group__label">Target Industries</label>
              <input className="form-input" value={industriesCsv} onChange={(e) => setIndustriesCsv(e.target.value)} placeholder="SaaS, Healthcare, ..." />
              <div className="form-group__hint">Comma-separated list</div>
            </div>
            <div className="form-group">
              <label className="form-group__label">Differentiators</label>
              <input className="form-input" value={differentiatorsCsv} onChange={(e) => setDifferentiatorsCsv(e.target.value)} placeholder="AI-powered, Real-time, ..." />
              <div className="form-group__hint">Comma-separated list</div>
            </div>
            <div className="form-group">
              <label className="form-group__label">Proof Points</label>
              <input className="form-input" value={proofPointsCsv} onChange={(e) => setProofPointsCsv(e.target.value)} placeholder="50% faster onboarding, ..." />
              <div className="form-group__hint">Comma-separated list</div>
            </div>
            <div className="form-group">
              <label className="form-group__label">Approved Terminology</label>
              <input className="form-input" value={terminologyCsv} onChange={(e) => setTerminologyCsv(e.target.value)} placeholder="Customer success, Revenue ops, ..." />
              <div className="form-group__hint">Comma-separated list</div>
            </div>
          </div>
          <div className="form-group">
            <label className="form-group__label">Banned Claims</label>
            <input className="form-input" value={bannedClaimsCsv} onChange={(e) => setBannedClaimsCsv(e.target.value)} placeholder="Guaranteed ROI, #1 in market, ..." />
            <div className="form-group__hint">Claims that should never appear in generated stories</div>
          </div>
          <div className="form-group">
            <label className="form-group__label">Writing Style Guide</label>
            <textarea
              className="form-textarea"
              value={settings.writing_style_guide}
              onChange={(e) =>
                setSettings((p) => ({ ...p, writing_style_guide: e.target.value }))
              }
              rows={4}
              placeholder="Tone guidelines, brand voice notes, style preferences..."
            />
          </div>
        </div>
      </div>

      <div className="card card--elevated">
        <div className="card__header">
          <div className="card__title">Default Generation Settings</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group">
            <label className="form-group__label">Default Story Length</label>
            <select
              className="form-select"
              value={settings.default_story_length}
              onChange={(e) =>
                setSettings((p) => ({
                  ...p,
                  default_story_length: e.target.value as StoryContextSettings["default_story_length"],
                }))
              }
            >
              {Object.entries(STORY_LENGTH_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-group__label">Default Story Outline</label>
            <select
              className="form-select"
              value={settings.default_story_outline}
              onChange={(e) =>
                setSettings((p) => ({
                  ...p,
                  default_story_outline: e.target.value as StoryContextSettings["default_story_outline"],
                }))
              }
            >
              {Object.entries(STORY_OUTLINE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-group__label">Default Story Format</label>
            <select
              className="form-select"
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
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-group__label">Default Story Type</label>
            <select
              className="form-select"
              value={settings.default_story_type}
              onChange={(e) =>
                setSettings((p) => ({
                  ...p,
                  default_story_type: e.target.value as StoryContextSettings["default_story_type"],
                }))
              }
            >
              {Object.entries(STORY_TYPE_INPUT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn--primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
