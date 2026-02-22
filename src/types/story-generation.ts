import { ALL_TOPICS, STORY_FORMATS, TOPIC_LABELS, type TaxonomyTopic, type StoryFormat } from "./taxonomy.js";

export const STORY_LENGTHS = ["SHORT", "MEDIUM", "LONG", "EXECUTIVE"] as const;
export type StoryLength = (typeof STORY_LENGTHS)[number];

export const STORY_OUTLINES = [
  "CHRONOLOGICAL_JOURNEY",
  "PROBLEM_SOLUTION_IMPACT",
  "BY_THE_NUMBERS",
  "EXECUTIVE_BRIEF",
  "IMPLEMENTATION_PLAYBOOK",
  "DEAL_ANATOMY",
] as const;
export type StoryOutline = (typeof STORY_OUTLINES)[number];

export const STORY_TYPES = [
  "FULL_ACCOUNT_JOURNEY",
  ...ALL_TOPICS,
] as const;
export type StoryTypeInput = (typeof STORY_TYPES)[number];

export interface StoryContextSettings {
  companyOverview?: string;
  products?: string[];
  targetPersonas?: string[];
  targetIndustries?: string[];
  differentiators?: string[];
  proofPoints?: string[];
  bannedClaims?: string[];
  writingStyleGuide?: string;
  approvedTerminology?: string[];
}

export interface StoryPromptDefaults {
  storyLength?: StoryLength;
  storyOutline?: StoryOutline;
  storyFormat?: StoryFormat;
  storyType?: StoryTypeInput;
}

export function storyTypeLabel(storyType: StoryTypeInput): string {
  if (storyType === "FULL_ACCOUNT_JOURNEY") {
    return "Full Account Journey";
  }
  return TOPIC_LABELS[storyType as TaxonomyTopic] ?? storyType;
}

export function storyLengthWordTarget(length: StoryLength): string {
  switch (length) {
    case "SHORT":
      return "500-800 words";
    case "MEDIUM":
      return "900-1400 words";
    case "LONG":
      return "1500-2400 words";
    case "EXECUTIVE":
      return "350-600 words";
    default:
      return "900-1400 words";
  }
}

export function storyOutlineGuide(outline: StoryOutline): string {
  switch (outline) {
    case "CHRONOLOGICAL_JOURNEY":
      return "Use sections: Executive Summary, Timeline, Journey Phases, Key Outcomes, Notable Quotes.";
    case "PROBLEM_SOLUTION_IMPACT":
      return "Use sections: Context, Problem, Why Previous Approach Failed, Solution Implementation, Impact, Lessons Learned.";
    case "BY_THE_NUMBERS":
      return "Lead with quantified outcomes; include metric table, benchmark comparisons, and key quote callouts.";
    case "EXECUTIVE_BRIEF":
      return "Use concise board-ready sections: Business Context, Strategic Decision, Financial/Operational Impact, Risks, Next Steps.";
    case "IMPLEMENTATION_PLAYBOOK":
      return "Use sections: Initial State, Rollout Plan, Stakeholders, Integrations, Risks/Mitigations, Time-to-Value.";
    case "DEAL_ANATOMY":
      return "Use sections: Opportunity Origin, Evaluation Criteria, Stakeholders, Competitive Landscape, Commercial Terms, Why Won.";
    default:
      return "Use a clear B2B case-study structure with outcomes and evidence.";
  }
}

export const STORY_FORMAT_VALUES = [...STORY_FORMATS] as readonly StoryFormat[];
