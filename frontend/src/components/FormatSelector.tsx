import type { StoryFormat } from "../types/taxonomy";
import { STORY_FORMAT_LABELS } from "../types/taxonomy";

const FORMATS = Object.entries(STORY_FORMAT_LABELS) as [StoryFormat, string][];
const FORMAT_DESCRIPTIONS: Record<StoryFormat, string> = {
  before_after_transformation:
    "Contrasts the before/after state with a clear transformation arc.",
  day_in_the_life:
    "Explains the day-to-day workflow shift after adoption.",
  by_the_numbers_snapshot:
    "Prioritizes quantified outcomes, benchmarks, and metrics.",
  video_testimonial_soundbite:
    "Optimizes for short customer quotes and social-ready snippets.",
  joint_webinar_presentation:
    "Frames content as a collaborative narrative for presentations.",
  peer_reference_call_guide:
    "Structures talking points for reference calls with prospects.",
  analyst_validated_study:
    "Uses evidence-forward structure with external-proof positioning.",
};

interface FormatSelectorProps {
  value: StoryFormat | "";
  onChange: (format: StoryFormat | "") => void;
}

export function FormatSelector({ value, onChange }: FormatSelectorProps) {
  return (
    <div className="format-selector">
      <label className="format-selector__label">Story Format</label>
      <div className="format-selector__grid">
        {FORMATS.map(([key, label]) => {
          const selected = value === key;
          return (
            <button
              key={key}
              type="button"
              className={`format-selector__option ${selected ? "format-selector__option--selected" : ""}`}
              onClick={() => onChange(selected ? "" : key)}
              aria-pressed={selected}
            >
              <span className="format-selector__icon">
                {getFormatIcon(key)}
              </span>
              <span>
                <span className="format-selector__text">{label}</span>
                <span className="format-selector__description">
                  {FORMAT_DESCRIPTIONS[key]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getFormatIcon(format: StoryFormat): string {
  const icons: Record<StoryFormat, string> = {
    before_after_transformation: "\u21C4",
    day_in_the_life: "\u23F0",
    by_the_numbers_snapshot: "#",
    video_testimonial_soundbite: "\u25B6",
    joint_webinar_presentation: "\uD83C\uDF10",
    peer_reference_call_guide: "\uD83D\uDCDE",
    analyst_validated_study: "\uD83D\uDCCA",
  };
  return icons[format] ?? "\u2726";
}
