/**
 * Landing Page Editor — Full-Screen Split-Pane UI
 *
 * Serves a rich Markdown editor at /editor/:pageId with:
 *   - Left pane: Markdown textarea + toolbar (bold, italic, headings, blockquotes, callouts)
 *   - Right pane: Live preview mirroring the public page design
 *   - Auto-save with debounce (1.5 s)
 *   - Collapsible edit-history sidebar
 *   - Callout box manager (add / edit / remove / reorder with icon picker)
 *   - Hero image URL field, subtitle field, custom CSS textarea
 *
 * Also exposes GET /editor/new?storyId=:id for creating a page from a story
 * and immediately redirecting into the editor.
 */

import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { LandingPageEditor } from "../services/landing-page-editor.js";

// ─── Authenticated request type ──────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: string;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createEditorPageRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const editorService = new LandingPageEditor(prisma);

  /**
   * GET /editor/new?storyId=:storyId&title=:title
   *
   * Creates a new landing page from a story and redirects to the editor.
   */
  router.get("/new", async (req: AuthReq, res: Response) => {
    const storyId = req.query.storyId as string | undefined;
    const title = (req.query.title as string) || "Untitled Landing Page";

    if (!storyId) {
      res.status(400).send(renderError("Missing storyId parameter"));
      return;
    }

    if (!req.organizationId || !req.userId) {
      res.status(401).send(renderError("Authentication required"));
      return;
    }

    try {
      const pageId = await editorService.create({
        storyId,
        organizationId: req.organizationId,
        createdById: req.userId,
        title,
      });
      res.redirect(`/editor/${pageId}`);
    } catch (err) {
      console.error("Create page for editor error:", err);
      res.status(500).send(renderError("Failed to create landing page"));
    }
  });

  /**
   * GET /editor/:pageId
   *
   * Serves the full-screen split-pane editor UI.
   * Page data is bootstrapped inline to avoid an extra fetch on load.
   */
  router.get("/:pageId", async (req: AuthReq, res: Response) => {
    try {
      const page = await editorService.getForEditing(req.params.pageId);

      const bootstrap = {
        id: page.id,
        slug: page.slug,
        title: page.title,
        subtitle: page.subtitle ?? "",
        status: page.status,
        editableBody: page.editableBody,
        heroImageUrl: page.heroImageUrl ?? "",
        calloutBoxes: (page.calloutBoxes as Array<{
          title: string;
          body: string;
          icon?: string;
        }>) ?? [],
        customCss: page.customCss ?? "",
        totalCallHours: page.totalCallHours,
        editHistory: page.edits.map((e: {
          editedBy: { name: string | null; email: string };
          editSummary: string | null;
          createdAt: Date;
        }) => ({
          editedBy: e.editedBy.name ?? e.editedBy.email,
          summary: e.editSummary,
          createdAt: e.createdAt.toISOString(),
        })),
      };

      res.send(renderEditorHtml(bootstrap));
    } catch (err) {
      console.error("Editor page load error:", err);
      res.status(404).send(renderError("Landing page not found"));
    }
  });

  return router;
}

// ─── Types for the template ──────────────────────────────────────────────────

interface EditorBootstrap {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  status: string;
  editableBody: string;
  heroImageUrl: string;
  calloutBoxes: Array<{ title: string; body: string; icon?: string }>;
  customCss: string;
  totalCallHours: number;
  editHistory: Array<{
    editedBy: string;
    summary: string | null;
    createdAt: string;
  }>;
}

// ─── HTML Template ───────────────────────────────────────────────────────────

function renderEditorHtml(data: EditorBootstrap): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Edit — ${escapeHtml(data.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
/* ─── Reset ──────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --color-bg: #f8f9fb;
  --color-surface: #ffffff;
  --color-text: #1a1a2e;
  --color-text-secondary: #555770;
  --color-text-muted: #94a3b8;
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-accent-light: #eef2ff;
  --color-border: #e5e7eb;
  --color-border-focus: #a5b4fc;
  --color-success: #059669;
  --color-success-light: #ecfdf5;
  --color-danger: #dc2626;
  --color-danger-light: #fef2f2;
  --color-warning: #d97706;
  --color-warning-light: #fffbeb;

  --color-callout-metric: #059669;
  --color-callout-quote: #7c3aed;
  --color-callout-insight: #2563eb;
  --color-callout-timeline: #d97706;
  --color-callout-warning: #dc2626;
  --color-callout-success: #059669;

  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  --font-serif: 'Georgia', 'Times New Roman', serif;
  --radius: 8px;
  --radius-lg: 12px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
  --transition: 0.15s ease;
}

body {
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
  line-height: 1.5;
  font-size: 14px;
  overflow: hidden;
  height: 100vh;
}

/* ─── Top Bar ────────────────────────────────────────────────────────── */
.topbar {
  height: 56px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 12px;
  z-index: 100;
}
.topbar__back {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: var(--radius);
  transition: background var(--transition);
}
.topbar__back:hover { background: var(--color-bg); }
.topbar__back svg { width: 16px; height: 16px; }
.topbar__title {
  font-size: 15px;
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar__status {
  font-size: 12px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 100px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.topbar__status--draft { background: var(--color-warning-light); color: var(--color-warning); }
.topbar__status--published { background: var(--color-success-light); color: var(--color-success); }
.topbar__status--archived { background: var(--color-danger-light); color: var(--color-danger); }
.topbar__save-indicator {
  font-size: 12px;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 80px;
}
.topbar__save-indicator .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
  transition: background var(--transition);
}
.topbar__save-indicator .dot--saving { background: var(--color-warning); }
.topbar__save-indicator .dot--error { background: var(--color-danger); }

.topbar__actions { display: flex; gap: 8px; }
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  transition: all var(--transition);
  white-space: nowrap;
}
.btn:hover { border-color: var(--color-text-muted); }
.btn svg { width: 14px; height: 14px; }
.btn--primary {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}
.btn--primary:hover { background: var(--color-accent-hover); border-color: var(--color-accent-hover); }
.btn--ghost { border-color: transparent; }
.btn--ghost:hover { background: var(--color-bg); border-color: transparent; }

/* ─── Main Layout ────────────────────────────────────────────────────── */
.editor-layout {
  display: flex;
  height: calc(100vh - 56px);
  overflow: hidden;
}

/* ─── Left Pane: Editor ──────────────────────────────────────────────── */
.editor-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}
.toolbar__group {
  display: flex;
  align-items: center;
  gap: 2px;
}
.toolbar__sep {
  width: 1px;
  height: 22px;
  background: var(--color-border);
  margin: 0 6px;
}
.toolbar__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-sans);
  transition: all var(--transition);
  position: relative;
}
.toolbar__btn:hover { background: var(--color-surface); color: var(--color-text); }
.toolbar__btn svg { width: 16px; height: 16px; }
.toolbar__btn--active { background: var(--color-accent-light); color: var(--color-accent); }
.toolbar__btn[title]::after {
  content: attr(title);
  position: absolute;
  bottom: -28px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 8px;
  background: var(--color-text);
  color: white;
  font-size: 11px;
  font-weight: 400;
  border-radius: 4px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition);
  z-index: 10;
}
.toolbar__btn:hover[title]::after { opacity: 1; }

/* Metadata fields */
.metadata-bar {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--color-surface);
}
.metadata-row {
  display: flex;
  gap: 12px;
}
.field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.field__label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}
.field__input {
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  font-family: var(--font-sans);
  color: var(--color-text);
  background: var(--color-bg);
  transition: border-color var(--transition);
  width: 100%;
}
.field__input:focus { outline: none; border-color: var(--color-border-focus); }
.field__input--title {
  font-size: 18px;
  font-weight: 600;
  border: none;
  background: transparent;
  padding: 4px 0;
}
.field__input--title:focus { border: none; }

/* Editor textarea */
.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.editor-textarea {
  flex: 1;
  resize: none;
  border: none;
  padding: 20px;
  font-family: var(--font-mono);
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text);
  background: var(--color-surface);
  tab-size: 2;
}
.editor-textarea:focus { outline: none; }
.editor-textarea::placeholder { color: var(--color-text-muted); }

/* ─── Right Pane: Preview ────────────────────────────────────────────── */
.preview-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}
.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}
.preview-header__title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}
.preview-viewport {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
.preview-frame {
  max-width: 720px;
  margin: 24px auto;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  min-height: 400px;
}

/* ─── Preview Content (mirrors public page styles) ───────────────────── */
.preview-content {
  padding: 3rem 2rem 4rem;
}
.preview-content .page-header {
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 2px solid var(--color-accent);
}
.preview-content .page-header h1 {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--color-text);
  margin-bottom: 0.4rem;
}
.preview-content .page-header .subtitle {
  font-size: 1.05rem;
  color: var(--color-text-secondary);
  font-weight: 400;
}
.preview-content .callouts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
  margin: 1.5rem 0;
}
.preview-content .callout {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
  display: flex;
  gap: 0.75rem;
  box-shadow: var(--shadow-sm);
}
.preview-content .callout__icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 7px;
}
.preview-content .callout__icon svg { width: 20px; height: 20px; }
.preview-content .callout--metric .callout__icon { background: #ecfdf5; color: var(--color-callout-metric); }
.preview-content .callout--quote .callout__icon { background: #f5f3ff; color: var(--color-callout-quote); }
.preview-content .callout--insight .callout__icon { background: #eff6ff; color: var(--color-callout-insight); }
.preview-content .callout--timeline .callout__icon { background: #fffbeb; color: var(--color-callout-timeline); }
.preview-content .callout--warning .callout__icon { background: #fef2f2; color: var(--color-callout-warning); }
.preview-content .callout--success .callout__icon { background: #ecfdf5; color: var(--color-callout-success); }
.preview-content .callout__title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}
.preview-content .callout--metric .callout__title { color: var(--color-callout-metric); }
.preview-content .callout--quote .callout__title { color: var(--color-callout-quote); }
.preview-content .callout--insight .callout__title { color: var(--color-callout-insight); }
.preview-content .callout--timeline .callout__title { color: var(--color-callout-timeline); }
.preview-content .callout--warning .callout__title { color: var(--color-callout-warning); }
.preview-content .callout--success .callout__title { color: var(--color-callout-success); }
.preview-content .callout__body { font-size: 0.9rem; color: var(--color-text); }
.preview-content .callout__body p { margin: 0; }
.preview-content .callout__body strong { font-weight: 700; font-size: 1.25rem; display: block; margin-bottom: 0.2rem; }

.preview-content .body-content h1 { font-size: 1.65rem; margin: 2rem 0 0.75rem; font-weight: 700; }
.preview-content .body-content h2 { font-size: 1.35rem; margin: 1.75rem 0 0.6rem; font-weight: 600; color: var(--color-accent); }
.preview-content .body-content h3 { font-size: 1.1rem; margin: 1.5rem 0 0.4rem; font-weight: 600; }
.preview-content .body-content h4 { font-size: 1rem; margin: 1.25rem 0 0.4rem; font-weight: 600; }
.preview-content .body-content p { margin-bottom: 0.85rem; line-height: 1.7; }
.preview-content .body-content ul { margin: 0.5rem 0 1.25rem 1.5rem; }
.preview-content .body-content li { margin-bottom: 0.3rem; }
.preview-content .body-content blockquote {
  border-left: 4px solid var(--color-accent);
  background: var(--color-accent-light);
  padding: 1rem 1.25rem;
  margin: 1.25rem 0;
  border-radius: 0 var(--radius) var(--radius) 0;
  font-style: italic;
}
.preview-content .body-content blockquote p { margin: 0; }
.preview-content .body-content strong { color: var(--color-text); }
.preview-content .body-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.25rem 0;
  font-size: 0.85rem;
}
.preview-content .body-content table tr:first-child td { font-weight: 600; background: var(--color-accent-light); }
.preview-content .body-content td {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--color-border);
}
.preview-content .body-content hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 1.5rem 0;
}
.preview-content .hero-img {
  width: 100%;
  height: 200px;
  background-size: cover;
  background-position: center;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

/* ─── History Sidebar ────────────────────────────────────────────────── */
.history-sidebar {
  width: 0;
  overflow: hidden;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  transition: width 0.25s ease;
  display: flex;
  flex-direction: column;
}
.history-sidebar--open { width: 280px; }
.history-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}
.history-sidebar__title {
  font-size: 13px;
  font-weight: 600;
}
.history-sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.history-item {
  padding: 10px 12px;
  border-radius: var(--radius);
  cursor: default;
  transition: background var(--transition);
}
.history-item:hover { background: var(--color-bg); }
.history-item__who {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}
.history-item__summary {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 2px;
}
.history-item__time {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 4px;
}
.history-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}

/* ─── Callout Manager Panel ──────────────────────────────────────────── */
.callout-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  z-index: 200;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.25s ease;
}
.callout-panel--open { transform: translateX(0); }
.callout-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}
.callout-panel__title { font-size: 15px; font-weight: 600; }
.callout-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.callout-panel__footer {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.callout-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 14px;
  margin-bottom: 10px;
  position: relative;
}
.callout-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.callout-card__drag {
  cursor: grab;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
}
.callout-card__drag:active { cursor: grabbing; }
.callout-card__actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.callout-card__actions button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--color-text-muted);
  transition: all var(--transition);
}
.callout-card__actions button:hover { background: var(--color-surface); color: var(--color-danger); }
.callout-card .field { margin-bottom: 8px; }
.callout-card .field:last-child { margin-bottom: 0; }
.callout-card textarea.field__input {
  min-height: 60px;
  resize: vertical;
  font-family: var(--font-sans);
}

/* Icon picker */
.icon-picker {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.icon-picker__option {
  width: 36px;
  height: 36px;
  border: 2px solid transparent;
  border-radius: var(--radius);
  background: var(--color-bg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  transition: all var(--transition);
}
.icon-picker__option:hover { border-color: var(--color-border); }
.icon-picker__option--selected { border-color: var(--color-accent); background: var(--color-accent-light); }
.icon-picker__option svg { width: 18px; height: 18px; }

/* ─── Advanced Panel (Custom CSS) ────────────────────────────────────── */
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  user-select: none;
}
.advanced-toggle svg {
  width: 14px;
  height: 14px;
  transition: transform var(--transition);
}
.advanced-toggle--open svg { transform: rotate(90deg); }
.advanced-content {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
  border-top: 1px solid var(--color-border);
}
.advanced-content--open { max-height: 300px; }
.advanced-content__inner { padding: 12px 16px; }
.css-textarea {
  width: 100%;
  min-height: 120px;
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  padding: 10px;
  color: var(--color-text);
  background: var(--color-bg);
}
.css-textarea:focus { outline: none; border-color: var(--color-border-focus); }

/* ─── Overlay backdrop ───────────────────────────────────────────────── */
.overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.2);
  z-index: 199;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
.overlay--visible { opacity: 1; pointer-events: auto; }

/* ─── Keyboard shortcuts hint ────────────────────────────────────────── */
kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 11px;
  font-family: var(--font-mono);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  color: var(--color-text-muted);
}
  </style>
</head>
<body>

<!-- ── Top Bar ──────────────────────────────────────────────────────── -->
<div class="topbar">
  <a href="/api/dashboard/pages" class="topbar__back">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
    Pages
  </a>
  <div class="topbar__title" id="topbarTitle">${escapeHtml(data.title)}</div>
  <span class="topbar__status topbar__status--${data.status.toLowerCase()}" id="topbarStatus">${escapeHtml(data.status)}</span>
  <div class="topbar__save-indicator" id="saveIndicator">
    <span class="dot"></span>
    <span id="saveText">Saved</span>
  </div>
  <div class="topbar__actions">
    <button class="btn btn--ghost" id="btnHistory" title="Edit history">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
      History
    </button>
    <button class="btn btn--ghost" id="btnCallouts" title="Manage callout boxes">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
      Callouts
    </button>
    <button class="btn btn--primary" id="btnPublish">Publish</button>
  </div>
</div>

<!-- ── Main Layout ─────────────────────────────────────────────────── -->
<div class="editor-layout">

  <!-- Left Pane: Editor -->
  <div class="editor-pane">
    <!-- Metadata -->
    <div class="metadata-bar">
      <div class="field">
        <input class="field__input field__input--title" id="titleInput" type="text"
          value="${escapeAttr(data.title)}" placeholder="Landing page title..." />
      </div>
      <div class="metadata-row">
        <div class="field">
          <label class="field__label">Subtitle</label>
          <input class="field__input" id="subtitleInput" type="text"
            value="${escapeAttr(data.subtitle)}" placeholder="Optional subtitle..." />
        </div>
        <div class="field">
          <label class="field__label">Hero Image URL</label>
          <input class="field__input" id="heroInput" type="url"
            value="${escapeAttr(data.heroImageUrl)}" placeholder="https://..." />
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar" role="toolbar" aria-label="Formatting toolbar">
      <div class="toolbar__group">
        <button class="toolbar__btn" data-action="h1" title="Heading 1"><strong>H1</strong></button>
        <button class="toolbar__btn" data-action="h2" title="Heading 2"><strong>H2</strong></button>
        <button class="toolbar__btn" data-action="h3" title="Heading 3"><strong>H3</strong></button>
      </div>
      <div class="toolbar__sep"></div>
      <div class="toolbar__group">
        <button class="toolbar__btn" data-action="bold" title="Bold (Ctrl+B)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg>
        </button>
        <button class="toolbar__btn" data-action="italic" title="Italic (Ctrl+I)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
        </button>
      </div>
      <div class="toolbar__sep"></div>
      <div class="toolbar__group">
        <button class="toolbar__btn" data-action="blockquote" title="Blockquote">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg>
        </button>
        <button class="toolbar__btn" data-action="ul" title="Bullet list">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
        </button>
        <button class="toolbar__btn" data-action="hr" title="Horizontal rule">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="12" x2="22" y2="12"/></svg>
        </button>
      </div>
      <div class="toolbar__sep"></div>
      <div class="toolbar__group">
        <button class="toolbar__btn" data-action="callout" title="Insert callout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
        </button>
      </div>
    </div>

    <!-- Editor textarea -->
    <div class="editor-area">
      <textarea class="editor-textarea" id="markdownEditor" placeholder="Start writing your landing page content...">${escapeHtml(data.editableBody)}</textarea>
    </div>

    <!-- Advanced: Custom CSS -->
    <div class="advanced-toggle" id="advancedToggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>
      Custom CSS (Advanced)
    </div>
    <div class="advanced-content" id="advancedContent">
      <div class="advanced-content__inner">
        <textarea class="css-textarea" id="customCssInput" placeholder="/* Add custom CSS overrides here */\n.content h2 { color: #333; }">${escapeHtml(data.customCss)}</textarea>
      </div>
    </div>
  </div>

  <!-- Right Pane: Preview -->
  <div class="preview-pane">
    <div class="preview-header">
      <span class="preview-header__title">Live Preview</span>
      <span style="font-size:12px;color:var(--color-text-muted)">
        /s/${escapeHtml(data.slug)}
      </span>
    </div>
    <div class="preview-viewport" id="previewViewport">
      <div class="preview-frame">
        <div id="previewHero"></div>
        <div class="preview-content">
          <header class="page-header">
            <h1 id="previewTitle">${escapeHtml(data.title)}</h1>
            <p class="subtitle" id="previewSubtitle">${escapeHtml(data.subtitle)}</p>
          </header>
          <section class="callouts" id="previewCallouts"></section>
          <article class="body-content" id="previewBody"></article>
        </div>
      </div>
    </div>
  </div>

  <!-- History Sidebar -->
  <div class="history-sidebar" id="historySidebar">
    <div class="history-sidebar__header">
      <span class="history-sidebar__title">Edit History</span>
      <button class="btn btn--ghost" id="btnCloseHistory" style="padding:4px 8px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="history-sidebar__list" id="historyList"></div>
  </div>
</div>

<!-- ── Callout Manager Panel ──────────────────────────────────────── -->
<div class="overlay" id="calloutOverlay"></div>
<div class="callout-panel" id="calloutPanel">
  <div class="callout-panel__header">
    <span class="callout-panel__title">Callout Boxes</span>
    <button class="btn btn--ghost" id="btnCloseCallouts" style="padding:4px 8px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
  <div class="callout-panel__body" id="calloutList"></div>
  <div class="callout-panel__footer">
    <button class="btn" id="btnAddCallout">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Callout
    </button>
  </div>
</div>

<!-- ── Custom CSS injection in preview ────────────────────────────── -->
<style id="customCssStyle"></style>

<script>
// ═══════════════════════════════════════════════════════════════════════
// Landing Page Editor — Client-Side Logic
// ═══════════════════════════════════════════════════════════════════════

(function() {
  "use strict";

  // ── Bootstrap data ────────────────────────────────────────────────
  const PAGE_ID = ${JSON.stringify(data.id)};
  const API_BASE = "/api/pages/" + PAGE_ID;

  let state = {
    title: ${JSON.stringify(data.title)},
    subtitle: ${JSON.stringify(data.subtitle)},
    editableBody: ${JSON.stringify(data.editableBody)},
    heroImageUrl: ${JSON.stringify(data.heroImageUrl)},
    calloutBoxes: ${JSON.stringify(data.calloutBoxes)},
    customCss: ${JSON.stringify(data.customCss)},
    editHistory: ${JSON.stringify(data.editHistory)},
  };

  // ── DOM refs ──────────────────────────────────────────────────────
  const $title = document.getElementById("titleInput");
  const $subtitle = document.getElementById("subtitleInput");
  const $hero = document.getElementById("heroInput");
  const $editor = document.getElementById("markdownEditor");
  const $customCss = document.getElementById("customCssInput");
  const $previewTitle = document.getElementById("previewTitle");
  const $previewSubtitle = document.getElementById("previewSubtitle");
  const $previewBody = document.getElementById("previewBody");
  const $previewHero = document.getElementById("previewHero");
  const $previewCallouts = document.getElementById("previewCallouts");
  const $saveText = document.getElementById("saveText");
  const $saveDot = document.querySelector("#saveIndicator .dot");
  const $topbarTitle = document.getElementById("topbarTitle");
  const $customCssStyle = document.getElementById("customCssStyle");

  // ── Callout icon SVGs ─────────────────────────────────────────────
  const CALLOUT_ICONS = {
    metric: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    quote: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg>',
    insight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    timeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>',
  };
  const ICON_NAMES = ["metric", "quote", "insight", "timeline", "warning", "success"];

  // ══════════════════════════════════════════════════════════════════
  // Markdown → HTML converter (mirrors server-side public renderer)
  // ══════════════════════════════════════════════════════════════════
  function mdToHtml(md) {
    var h = md
      .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
      .replace(/\\*(.+?)\\*/g, "<em>$1</em>")
      .replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/^---$/gm, "<hr>")
      .replace(/^\\|(.+)\\|$/gm, function(_, c) {
        return "<tr>" + c.split("|").map(function(s){ return "<td>"+s.trim()+"</td>"; }).join("") + "</tr>";
      })
      .replace(/\\n\\n/g, "</p><p>")
      .replace(/\\n/g, "<br>");
    h = h.replace(/(<li>[\\s\\S]*?<\\/li>(?:<br>)*)+/g, function(m) {
      return "<ul>" + m.replace(/<br>/g, "") + "</ul>";
    });
    h = "<p>" + h + "</p>";
    h = h.replace(/<p><\\/p>/g, "");
    h = h.replace(/<p>(<h[1-4]>)/g, "$1");
    h = h.replace(/(<\\/h[1-4]>)<\\/p>/g, "$1");
    h = h.replace(/<p>(<blockquote>)/g, "$1");
    h = h.replace(/(<\\/blockquote>)<\\/p>/g, "$1");
    h = h.replace(/<p>(<ul>)/g, "$1");
    h = h.replace(/(<\\/ul>)<\\/p>/g, "$1");
    h = h.replace(/<p>(<hr>)<\\/p>/g, "$1");
    h = h.replace(/(<tr>[\\s\\S]*?<\\/tr>(?:\\s*<tr>[\\s\\S]*?<\\/tr>)*)/g, "<table>$1</table>");
    return h;
  }

  // ══════════════════════════════════════════════════════════════════
  // Live Preview
  // ══════════════════════════════════════════════════════════════════
  function updatePreview() {
    $previewTitle.textContent = state.title || "Untitled";
    $previewSubtitle.textContent = state.subtitle || "";
    $previewSubtitle.style.display = state.subtitle ? "" : "none";

    // Hero image
    if (state.heroImageUrl) {
      $previewHero.className = "preview-content hero-img";
      $previewHero.style.backgroundImage = "url('" + state.heroImageUrl + "')";
      $previewHero.style.height = "200px";
      $previewHero.style.backgroundSize = "cover";
      $previewHero.style.backgroundPosition = "center";
    } else {
      $previewHero.className = "";
      $previewHero.style.backgroundImage = "";
      $previewHero.style.height = "0";
    }

    // Callout boxes
    renderPreviewCallouts();

    // Body
    $previewBody.innerHTML = mdToHtml(state.editableBody);

    // Custom CSS
    $customCssStyle.textContent = state.customCss || "";

    $topbarTitle.textContent = state.title || "Untitled";
  }

  function renderPreviewCallouts() {
    if (!state.calloutBoxes || state.calloutBoxes.length === 0) {
      $previewCallouts.style.display = "none";
      $previewCallouts.innerHTML = "";
      return;
    }
    $previewCallouts.style.display = "";
    $previewCallouts.innerHTML = state.calloutBoxes.map(function(box) {
      var icon = box.icon || "insight";
      return '<div class="callout callout--' + esc(icon) + '">' +
        '<div class="callout__icon">' + (CALLOUT_ICONS[icon] || CALLOUT_ICONS.insight) + '</div>' +
        '<div class="callout__content">' +
          '<h3 class="callout__title">' + esc(box.title) + '</h3>' +
          '<div class="callout__body">' + mdToHtml(box.body) + '</div>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ══════════════════════════════════════════════════════════════════
  // Auto-Save with Debounce
  // ══════════════════════════════════════════════════════════════════
  var saveTimer = null;
  var isSaving = false;

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    $saveDot.className = "dot dot--saving";
    $saveText.textContent = "Unsaved";
    saveTimer = setTimeout(doSave, 1500);
  }

  function doSave() {
    if (isSaving) {
      scheduleSave();
      return;
    }
    isSaving = true;
    $saveDot.className = "dot dot--saving";
    $saveText.textContent = "Saving...";

    var payload = {
      title: state.title,
      subtitle: state.subtitle || undefined,
      editable_body: state.editableBody,
      hero_image_url: state.heroImageUrl || undefined,
      callout_boxes: state.calloutBoxes,
      custom_css: state.customCss || undefined,
    };

    fetch(API_BASE, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    .then(function(res) {
      if (!res.ok) throw new Error("Save failed: " + res.status);
      $saveDot.className = "dot";
      $saveText.textContent = "Saved";
      isSaving = false;
    })
    .catch(function(err) {
      console.error("Auto-save error:", err);
      $saveDot.className = "dot dot--error";
      $saveText.textContent = "Error";
      isSaving = false;
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // Input Handlers
  // ══════════════════════════════════════════════════════════════════
  $title.addEventListener("input", function() {
    state.title = this.value;
    updatePreview();
    scheduleSave();
  });
  $subtitle.addEventListener("input", function() {
    state.subtitle = this.value;
    updatePreview();
    scheduleSave();
  });
  $hero.addEventListener("input", function() {
    state.heroImageUrl = this.value;
    updatePreview();
    scheduleSave();
  });
  $editor.addEventListener("input", function() {
    state.editableBody = this.value;
    updatePreview();
    scheduleSave();
  });
  $customCss.addEventListener("input", function() {
    state.customCss = this.value;
    updatePreview();
    scheduleSave();
  });

  // ══════════════════════════════════════════════════════════════════
  // Toolbar Actions
  // ══════════════════════════════════════════════════════════════════
  function wrapSelection(before, after) {
    var start = $editor.selectionStart;
    var end = $editor.selectionEnd;
    var text = $editor.value;
    var selected = text.substring(start, end) || "text";
    $editor.value = text.substring(0, start) + before + selected + after + text.substring(end);
    $editor.selectionStart = start + before.length;
    $editor.selectionEnd = start + before.length + selected.length;
    $editor.focus();
    state.editableBody = $editor.value;
    updatePreview();
    scheduleSave();
  }

  function insertAtLineStart(prefix) {
    var start = $editor.selectionStart;
    var text = $editor.value;
    // Find start of current line
    var lineStart = text.lastIndexOf("\\n", start - 1) + 1;
    $editor.value = text.substring(0, lineStart) + prefix + text.substring(lineStart);
    $editor.selectionStart = $editor.selectionEnd = lineStart + prefix.length;
    $editor.focus();
    state.editableBody = $editor.value;
    updatePreview();
    scheduleSave();
  }

  document.querySelector(".toolbar").addEventListener("click", function(e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.dataset.action;
    switch (action) {
      case "bold": wrapSelection("**", "**"); break;
      case "italic": wrapSelection("*", "*"); break;
      case "h1": insertAtLineStart("# "); break;
      case "h2": insertAtLineStart("## "); break;
      case "h3": insertAtLineStart("### "); break;
      case "blockquote": insertAtLineStart("> "); break;
      case "ul": insertAtLineStart("- "); break;
      case "hr":
        var s = $editor.selectionStart;
        var t = $editor.value;
        $editor.value = t.substring(0, s) + "\\n---\\n" + t.substring(s);
        $editor.selectionStart = $editor.selectionEnd = s + 5;
        $editor.focus();
        state.editableBody = $editor.value;
        updatePreview();
        scheduleSave();
        break;
      case "callout":
        // Open callout panel and add a new one
        openCalloutPanel();
        addCallout();
        break;
    }
  });

  // Keyboard shortcuts
  $editor.addEventListener("keydown", function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      wrapSelection("**", "**");
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "i") {
      e.preventDefault();
      wrapSelection("*", "*");
    }
    // Tab for indent
    if (e.key === "Tab") {
      e.preventDefault();
      var s = this.selectionStart;
      this.value = this.value.substring(0, s) + "  " + this.value.substring(this.selectionEnd);
      this.selectionStart = this.selectionEnd = s + 2;
      state.editableBody = this.value;
      updatePreview();
      scheduleSave();
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // History Sidebar
  // ══════════════════════════════════════════════════════════════════
  var $historySidebar = document.getElementById("historySidebar");
  var $historyList = document.getElementById("historyList");
  var historyOpen = false;

  function toggleHistory() {
    historyOpen = !historyOpen;
    $historySidebar.classList.toggle("history-sidebar--open", historyOpen);
    if (historyOpen) renderHistory();
  }

  function renderHistory() {
    if (!state.editHistory || state.editHistory.length === 0) {
      $historyList.innerHTML = '<div class="history-empty">No edit history yet.<br>Edits are recorded each time the body is saved.</div>';
      return;
    }
    $historyList.innerHTML = state.editHistory.map(function(entry) {
      var date = new Date(entry.createdAt);
      var timeStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " at " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      return '<div class="history-item">' +
        '<div class="history-item__who">' + esc(entry.editedBy) + '</div>' +
        (entry.summary ? '<div class="history-item__summary">' + esc(entry.summary) + '</div>' : '') +
        '<div class="history-item__time">' + timeStr + '</div>' +
      '</div>';
    }).join("");
  }

  document.getElementById("btnHistory").addEventListener("click", toggleHistory);
  document.getElementById("btnCloseHistory").addEventListener("click", toggleHistory);

  // ══════════════════════════════════════════════════════════════════
  // Callout Box Manager
  // ══════════════════════════════════════════════════════════════════
  var $calloutPanel = document.getElementById("calloutPanel");
  var $calloutOverlay = document.getElementById("calloutOverlay");
  var $calloutList = document.getElementById("calloutList");
  var calloutOpen = false;

  function openCalloutPanel() {
    if (calloutOpen) return;
    calloutOpen = true;
    $calloutPanel.classList.add("callout-panel--open");
    $calloutOverlay.classList.add("overlay--visible");
    renderCalloutCards();
  }

  function closeCalloutPanel() {
    calloutOpen = false;
    $calloutPanel.classList.remove("callout-panel--open");
    $calloutOverlay.classList.remove("overlay--visible");
  }

  function addCallout() {
    state.calloutBoxes.push({ title: "", body: "", icon: "insight" });
    renderCalloutCards();
    scheduleSave();
  }

  function removeCallout(idx) {
    state.calloutBoxes.splice(idx, 1);
    renderCalloutCards();
    updatePreview();
    scheduleSave();
  }

  function moveCallout(from, to) {
    if (to < 0 || to >= state.calloutBoxes.length) return;
    var item = state.calloutBoxes.splice(from, 1)[0];
    state.calloutBoxes.splice(to, 0, item);
    renderCalloutCards();
    updatePreview();
    scheduleSave();
  }

  function renderCalloutCards() {
    if (state.calloutBoxes.length === 0) {
      $calloutList.innerHTML = '<div class="history-empty">No callout boxes yet.<br>Click "Add Callout" to create one.</div>';
      return;
    }
    $calloutList.innerHTML = state.calloutBoxes.map(function(box, i) {
      return '<div class="callout-card" data-idx="' + i + '">' +
        '<div class="callout-card__header">' +
          '<span class="callout-card__drag" title="Drag to reorder">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>' +
          '</span>' +
          '<span style="font-size:12px;font-weight:600;color:var(--color-text-secondary)">Callout ' + (i+1) + '</span>' +
          '<div class="callout-card__actions">' +
            '<button onclick="window._editorMoveCallout(' + i + ',' + (i-1) + ')" title="Move up">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 15l-6-6-6 6"/></svg>' +
            '</button>' +
            '<button onclick="window._editorMoveCallout(' + i + ',' + (i+1) + ')" title="Move down">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>' +
            '</button>' +
            '<button onclick="window._editorRemoveCallout(' + i + ')" title="Remove">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label">Icon</label>' +
          '<div class="icon-picker">' +
            ICON_NAMES.map(function(name) {
              return '<button class="icon-picker__option' + (box.icon === name ? ' icon-picker__option--selected' : '') + '" ' +
                'onclick="window._editorSetCalloutIcon(' + i + ',\\'' + name + '\\')" title="' + name + '">' +
                CALLOUT_ICONS[name] +
              '</button>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label">Title</label>' +
          '<input class="field__input" value="' + escAttr(box.title) + '" ' +
            'oninput="window._editorUpdateCallout(' + i + ',\\'title\\',this.value)" placeholder="e.g. Cost Savings" />' +
        '</div>' +
        '<div class="field">' +
          '<label class="field__label">Body</label>' +
          '<textarea class="field__input" rows="3" ' +
            'oninput="window._editorUpdateCallout(' + i + ',\\'body\\',this.value)" placeholder="Callout content... supports **bold** markdown">' +
            esc(box.body) +
          '</textarea>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function escAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Expose callout methods to inline handlers
  window._editorRemoveCallout = removeCallout;
  window._editorMoveCallout = moveCallout;
  window._editorSetCalloutIcon = function(idx, icon) {
    state.calloutBoxes[idx].icon = icon;
    renderCalloutCards();
    updatePreview();
    scheduleSave();
  };
  window._editorUpdateCallout = function(idx, field, value) {
    state.calloutBoxes[idx][field] = value;
    updatePreview();
    scheduleSave();
  };

  document.getElementById("btnCallouts").addEventListener("click", openCalloutPanel);
  document.getElementById("btnCloseCallouts").addEventListener("click", closeCalloutPanel);
  $calloutOverlay.addEventListener("click", closeCalloutPanel);
  document.getElementById("btnAddCallout").addEventListener("click", addCallout);

  // ══════════════════════════════════════════════════════════════════
  // Advanced CSS Toggle
  // ══════════════════════════════════════════════════════════════════
  var $advToggle = document.getElementById("advancedToggle");
  var $advContent = document.getElementById("advancedContent");
  var advOpen = false;

  $advToggle.addEventListener("click", function() {
    advOpen = !advOpen;
    $advToggle.classList.toggle("advanced-toggle--open", advOpen);
    $advContent.classList.toggle("advanced-content--open", advOpen);
  });

  // ══════════════════════════════════════════════════════════════════
  // Publish Button
  // ══════════════════════════════════════════════════════════════════
  document.getElementById("btnPublish").addEventListener("click", function() {
    if (!confirm("Publish this landing page? It will be accessible via a shared link.")) return;
    fetch(API_BASE + "/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: "SHARED_WITH_LINK" }),
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.published) {
        document.getElementById("topbarStatus").textContent = "PUBLISHED";
        document.getElementById("topbarStatus").className = "topbar__status topbar__status--published";
        alert("Published! URL: " + data.url);
      }
    })
    .catch(function(err) {
      console.error("Publish error:", err);
      alert("Failed to publish. Please try again.");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Initial Render
  // ══════════════════════════════════════════════════════════════════
  updatePreview();
})();
</script>
</body>
</html>`;
}

// ─── Error Page ──────────────────────────────────────────────────────────────

function renderError(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Error</title>
  <style>
    body { font-family: 'Inter', sans-serif; background: #f8f9fb; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: white; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 420px; text-align: center; }
    h2 { color: #1a1a2e; margin-bottom: 0.5rem; }
    p { color: #555770; }
    a { color: #4f46e5; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Something went wrong</h2>
    <p>${escapeHtml(message)}</p>
    <p style="margin-top:1rem"><a href="/api/dashboard/pages">Back to pages</a></p>
  </div>
</body>
</html>`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
