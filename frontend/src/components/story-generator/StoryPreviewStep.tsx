/**
 * StoryPreviewStep — generated story preview with streaming.
 *
 * Re-exports the existing StoryPreviewSection / StoryLoadingSection / StoryErrorSection
 * from StoryModalSections as a convenience, plus adds the wrapper that the modal shell
 * delegates to when phase === "loading" | "preview" | "error".
 */

export {
  StoryLoadingSection,
  StoryPreviewSection,
  StoryErrorSection,
} from "./StoryModalSections";
