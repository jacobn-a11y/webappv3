import type { StoryFormat } from "../types/taxonomy";
import { STORY_FORMAT_LABELS } from "../types/taxonomy";

const FORMATS = Object.entries(STORY_FORMAT_LABELS) as [StoryFormat, string][];

interface FormatSelectorProps {
  value: StoryFormat | "";
  onChange: (format: StoryFormat | "") => void;
}

export function FormatSelector({ value, onChange }: FormatSelectorProps) {
  return (
    <div className="format-selector">
      <label className="format-selector__label">Story Format</label>
      <div className="format-selector__grid">
        {FORMATS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`format-selector__option ${value === key ? "format-selector__option--selected" : ""}`}
            onClick={() => onChange(value === key ? "" : key)}
          >
            <span className="format-selector__icon">
              {getFormatIcon(key)}
            </span>
            <span className="format-selector__text">{label}</span>
          </button>
        ))}
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
