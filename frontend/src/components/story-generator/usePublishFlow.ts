import { useCallback, useState } from "react";
import {
  createLandingPage,
  downloadStoryExport,
  savePageDraft,
  type BuildStoryResponse,
} from "../../lib/api";

function sanitizeFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function usePublishFlow(options: {
  accountName: string;
  includeCompanyName?: boolean;
  namedModeConfirmed?: boolean;
  onError: (message: string) => void;
  onPackagingAction?: (
    actionName: string,
    metadata?: Record<string, unknown>
  ) => void;
  onLandingPageCreated?: (pageId: string, slug: string) => void;
  previewMarkdown: string;
  result: BuildStoryResponse | null;
}) {
  const {
    accountName,
    includeCompanyName = false,
    namedModeConfirmed = false,
    onError,
    onPackagingAction,
    onLandingPageCreated,
    previewMarkdown,
    result,
  } = options;

  const [copyFeedback, setCopyFeedback] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "docx" | null>(
    null
  );

  const handleCopyToClipboard = useCallback(async () => {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(previewMarkdown);
      onPackagingAction?.("copy_markdown");
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = previewMarkdown;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      onPackagingAction?.("copy_markdown_fallback");
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  }, [onPackagingAction, previewMarkdown, result]);

  const handleDownloadMarkdown = useCallback(() => {
    if (!result) return;

    const title = sanitizeFileName(result.title || `${accountName}-story`);
    const blob = new Blob([previewMarkdown], {
      type: "text/markdown;charset=utf-8",
    });
    saveBlob(blob, `${title || "story"}.md`);
    onPackagingAction?.("download_markdown");
  }, [accountName, onPackagingAction, previewMarkdown, result]);

  const handleDownloadExport = useCallback(
    async (format: "pdf" | "docx") => {
      if (!result?.story_id) return;

      const title = sanitizeFileName(result.title || `${accountName}-story`);
      setExportingFormat(format);
      try {
        const proceed = window.confirm(
          "This export may contain PII or named customer data. Confirm you have permission to share externally."
        );
        if (!proceed) {
          return;
        }
        const blob = await downloadStoryExport(result.story_id, format);
        saveBlob(blob, `${title || "story"}.${format}`);
        onPackagingAction?.("download_export", { format });
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to export story");
      } finally {
        setExportingFormat(null);
      }
    },
    [accountName, onError, onPackagingAction, result]
  );

  const handleCreateLandingPage = useCallback(async () => {
    if (!result?.story_id) {
      onError("Could not find generated story id. Please regenerate and try again.");
      return;
    }

    if (includeCompanyName && !namedModeConfirmed) {
      onError(
        "Named mode requires explicit customer permission confirmation before publishing."
      );
      return;
    }

    setCreatingPage(true);
    try {
      const page = await createLandingPage({
        story_id: result.story_id,
        title: result.title,
        include_company_name: includeCompanyName || undefined,
      });

      if (previewMarkdown && previewMarkdown !== result.markdown) {
        await savePageDraft(page.id, previewMarkdown);
      }

      onPackagingAction?.("create_landing_page", {
        page_id: page.id,
        page_slug: page.slug,
      });
      onLandingPageCreated?.(page.id, page.slug);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create landing page");
    } finally {
      setCreatingPage(false);
    }
  }, [
    includeCompanyName,
    namedModeConfirmed,
    onError,
    onPackagingAction,
    onLandingPageCreated,
    previewMarkdown,
    result,
  ]);

  return {
    copyFeedback,
    creatingPage,
    exportingFormat,
    handleCopyToClipboard,
    handleCreateLandingPage,
    handleDownloadExport,
    handleDownloadMarkdown,
  };
}
