import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildStory,
  buildStoryStream,
  type BuildStoryRequest,
  type BuildStoryResponse,
} from "../../lib/api";

type ModalPhase = "form" | "loading" | "preview" | "error";

const PROGRESS_TO_PERCENT: Record<string, number> = {
  STARTED: 8,
  MERGING_TRANSCRIPTS: 20,
  GATHERING_SEGMENTS: 38,
  GENERATING_NARRATIVE: 68,
  EXTRACTING_QUOTES: 84,
  SAVING_STORY: 94,
  DONE: 100,
};

const PROGRESS_COPY: Record<string, string> = {
  STARTED: "Preparing story generation.",
  MERGING_TRANSCRIPTS: "Merging account transcripts into a unified timeline.",
  GATHERING_SEGMENTS: "Gathering tagged evidence from transcript segments.",
  GENERATING_NARRATIVE: "Generating draft narrative from transcript evidence.",
  EXTRACTING_QUOTES: "Extracting quantified high-value quotes.",
  SAVING_STORY: "Saving your story and quote lineage.",
  DONE: "Finalizing story output.",
};

export function useStoryGeneration(onClose: () => void) {
  const requestControllerRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<ModalPhase>("form");
  const [result, setResult] = useState<BuildStoryResponse | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [streamedMarkdown, setStreamedMarkdown] = useState("");
  const [lastProgressStep, setLastProgressStep] = useState("STARTED");
  const [error, setError] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(8);

  const abortGeneration = useCallback(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
  }, []);

  const runGeneration = useCallback(async (requestBody: BuildStoryRequest) => {
    setPhase("loading");
    setError("");
    setLoadingProgress(8);
    setLastProgressStep("STARTED");
    setStreamedMarkdown("");
    setPreviewMarkdown("");
    setEditMode(false);

    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      const res = await buildStoryStream(
        requestBody,
        {
          onProgress: (step) => {
            setLastProgressStep(step);
            const mapped = PROGRESS_TO_PERCENT[step];
            if (mapped != null) {
              setLoadingProgress((prev) => Math.max(prev, mapped));
            }
          },
          onToken: (token) => {
            setStreamedMarkdown((prev) => prev + token);
            setLoadingProgress((prev) => Math.max(prev, 72));
          },
        },
        { signal: controller.signal }
      );

      setLoadingProgress(100);
      setLastProgressStep("DONE");
      setResult(res);
      setPreviewMarkdown(res.markdown);
      setPhase("preview");
    } catch (err) {
      const isAbort =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      if (isAbort) {
        setPhase("form");
        setError("");
        return;
      }

      const errorMessage =
        err instanceof Error ? err.message : "Failed to generate story";

      const canFallback =
        errorMessage.toLowerCase().includes("stream") ||
        errorMessage.toLowerCase().includes("event") ||
        errorMessage.toLowerCase().includes("browser");

      if (canFallback) {
        try {
          const fallbackRes = await buildStory(requestBody, {
            signal: controller.signal,
          });
          setLoadingProgress(100);
          setLastProgressStep("DONE");
          setResult(fallbackRes);
          setPreviewMarkdown(fallbackRes.markdown);
          setPhase("preview");
          return;
        } catch (fallbackErr) {
          const fallbackMessage =
            fallbackErr instanceof Error
              ? fallbackErr.message
              : "Failed to generate story";
          setError(fallbackMessage);
          setPhase("error");
          return;
        }
      }

      setError(errorMessage);
      setPhase("error");
    } finally {
      requestControllerRef.current = null;
    }
  }, []);

  const handleCancelGeneration = useCallback(() => {
    abortGeneration();
    onClose();
  }, [abortGeneration, onClose]);

  const handleBackToForm = useCallback(() => {
    setPhase("form");
    setError("");
  }, []);

  useEffect(() => {
    if (phase !== "loading") {
      return;
    }

    const timerId = window.setInterval(() => {
      setLoadingProgress((prev) => Math.min(prev + 4, 94));
    }, 700);

    return () => {
      window.clearInterval(timerId);
    };
  }, [phase]);

  return {
    abortGeneration,
    editMode,
    error,
    handleBackToForm,
    handleCancelGeneration,
    lastProgressStep,
    loadingMessage: PROGRESS_COPY[lastProgressStep] ?? PROGRESS_COPY.STARTED,
    loadingProgress,
    phase,
    previewMarkdown,
    result,
    runGeneration,
    setEditMode,
    setError,
    setPhase,
    setPreviewMarkdown,
    stream: streamedMarkdown,
  };
}
