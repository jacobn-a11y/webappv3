/**
 * Editor Page Renderer
 *
 * Serves the landing page editor at /editor/:pageId.
 * Includes a Publish button that opens a modal with:
 *   - Visibility toggle (Private / Shared with Link)
 *   - Optional password field
 *   - Optional expiration date picker
 *   - Side-by-side scrub preview (original vs scrubbed)
 *   - "Include company name" toggle (only for users with PUBLISH_NAMED_LANDING_PAGE)
 *   - Shareable URL display after publish
 */

import { Router, type Request, type Response } from "express";
import { LandingPageEditor } from "../services/landing-page-editor.js";
import { requirePageOwnerOrPermission } from "../middleware/permissions.js";
import type { PrismaClient } from "@prisma/client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: string;
}

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createEditorPageRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);

  /**
   * GET /editor/:pageId
   *
   * Serves the full editor UI with the embedded publish modal.
   * Auth required — user must own the page or have edit_any permission.
   */
  router.get(
    "/:pageId",
    requirePageOwnerOrPermission(prisma),
    async (req: AuthReq, res: Response) => {
      try {
        const page = await editor.getForEditing(req.params.pageId as string);

        // Check PUBLISH_NAMED_LANDING_PAGE permission
        let canPublishNamed = false;
        const ADMIN_ROLES = ["OWNER", "ADMIN"];
        if (req.userRole && ADMIN_ROLES.includes(req.userRole)) {
          canPublishNamed = true;
        } else if (req.userId) {
          const namedPerm = await prisma.userPermission.findUnique({
            where: {
              userId_permission: {
                userId: req.userId,
                permission: "PUBLISH_NAMED_LANDING_PAGE",
              },
            },
          });
          canPublishNamed = !!namedPerm;
        }

        res.send(
          renderEditorPage({
            pageId: page.id,
            title: page.title,
            subtitle: page.subtitle ?? "",
            editableBody: page.editableBody,
            status: page.status,
            visibility: page.visibility,
            includeCompanyName: page.includeCompanyName,
            canPublishNamed,
          })
        );
      } catch (err) {
        console.error("Editor page error:", err);
        res.status(404).send(render404());
      }
    }
  );

  return router;
}

// ─── Editor HTML Template ───────────────────────────────────────────────────

function renderEditorPage(ctx: {
  pageId: string;
  title: string;
  subtitle: string;
  editableBody: string;
  status: string;
  visibility: string;
  includeCompanyName: boolean;
  canPublishNamed: boolean;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Edit: ${escapeHtml(ctx.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #f8f9fb;
      --color-surface: #ffffff;
      --color-text: #1a1a2e;
      --color-text-secondary: #555770;
      --color-accent: #4f46e5;
      --color-accent-hover: #4338ca;
      --color-accent-light: #eef2ff;
      --color-border: #e5e7eb;
      --color-danger: #dc2626;
      --color-warning-bg: #fef3c7;
      --color-warning-border: #f59e0b;
      --color-warning-text: #92400e;
      --color-success: #059669;
      --color-success-bg: #ecfdf5;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Top Bar ──────────────────────────────────────────────── */
    .topbar {
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .topbar__left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .topbar__title {
      font-size: 16px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .topbar__status {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 3px 8px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .topbar__status--draft { background: #f3f4f6; color: #6b7280; }
    .topbar__status--published { background: var(--color-success-bg); color: var(--color-success); }
    .topbar__right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    /* ─── Buttons ──────────────────────────────────────────────── */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      font-family: var(--font-sans);
      cursor: pointer;
      transition: all 0.15s;
      background: var(--color-surface);
      color: var(--color-text);
    }
    .btn:hover { border-color: #c5c8ce; background: #f9fafb; }
    .btn--primary {
      background: var(--color-accent);
      color: white;
      border-color: var(--color-accent);
    }
    .btn--primary:hover {
      background: var(--color-accent-hover);
      border-color: var(--color-accent-hover);
    }
    .btn--primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn--sm { padding: 6px 12px; font-size: 12px; }
    .btn svg { width: 16px; height: 16px; }

    /* ─── Editor Area ─────────────────────────────────────────── */
    .editor-area {
      max-width: 800px;
      margin: 32px auto;
      padding: 0 24px;
    }
    .editor-area textarea {
      width: 100%;
      min-height: 500px;
      padding: 24px;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      font-family: var(--font-mono);
      font-size: 14px;
      line-height: 1.7;
      resize: vertical;
      background: var(--color-surface);
      color: var(--color-text);
    }
    .editor-area textarea:focus {
      outline: none;
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }

    /* ─── Modal Overlay ───────────────────────────────────────── */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: var(--color-surface);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      width: 100%;
      max-width: 960px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ─── Modal Header ────────────────────────────────────────── */
    .modal__header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal__header h2 {
      font-size: 18px;
      font-weight: 600;
    }
    .modal__close {
      width: 32px;
      height: 32px;
      border: none;
      background: none;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-secondary);
    }
    .modal__close:hover { background: #f3f4f6; }
    .modal__close svg { width: 20px; height: 20px; }

    /* ─── Modal Body ──────────────────────────────────────────── */
    .modal__body {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
    }

    /* ─── Publish Settings ────────────────────────────────────── */
    .publish-settings {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 640px) {
      .publish-settings { grid-template-columns: 1fr; }
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field__label {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text);
    }
    .field__hint {
      font-size: 12px;
      color: var(--color-text-secondary);
    }

    /* ─── Toggle Switch ───────────────────────────────────────── */
    .toggle-group {
      display: flex;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      overflow: hidden;
    }
    .toggle-group__option {
      flex: 1;
      padding: 8px 12px;
      text-align: center;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      background: var(--color-surface);
      color: var(--color-text-secondary);
      font-family: var(--font-sans);
      transition: all 0.15s;
    }
    .toggle-group__option:not(:last-child) {
      border-right: 1px solid var(--color-border);
    }
    .toggle-group__option.active {
      background: var(--color-accent);
      color: white;
    }

    /* ─── Checkbox Toggle ─────────────────────────────────────── */
    .toggle-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 16px;
      background: #f9fafb;
      border: 1px solid var(--color-border);
      border-radius: 8px;
    }
    .toggle-row input[type="checkbox"] {
      width: 18px;
      height: 18px;
      margin-top: 2px;
      accent-color: var(--color-accent);
      flex-shrink: 0;
    }
    .toggle-row__label {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text);
    }
    .toggle-row__desc {
      font-size: 12px;
      color: var(--color-text-secondary);
      margin-top: 2px;
    }

    /* ─── Warning Banner ──────────────────────────────────────── */
    .warning-banner {
      display: none;
      padding: 10px 14px;
      background: var(--color-warning-bg);
      border: 1px solid var(--color-warning-border);
      border-radius: 8px;
      font-size: 12px;
      color: var(--color-warning-text);
      margin-top: 8px;
      line-height: 1.5;
    }
    .warning-banner.visible { display: block; }
    .warning-banner svg {
      width: 14px;
      height: 14px;
      display: inline;
      vertical-align: -2px;
      margin-right: 4px;
    }

    /* ─── Text Input ──────────────────────────────────────────── */
    .text-input {
      padding: 8px 12px;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      font-size: 13px;
      font-family: var(--font-sans);
      color: var(--color-text);
      background: var(--color-surface);
    }
    .text-input:focus {
      outline: none;
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }
    .text-input:disabled {
      background: #f3f4f6;
      color: #9ca3af;
    }

    /* ─── Side-by-Side Preview ────────────────────────────────── */
    .preview-section {
      margin-top: 24px;
    }
    .preview-section__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .preview-section__title {
      font-size: 14px;
      font-weight: 600;
    }
    .preview-section__badge {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .preview-section__badge--count {
      background: var(--color-accent-light);
      color: var(--color-accent);
    }
    .preview-panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      overflow: hidden;
    }
    @media (max-width: 640px) {
      .preview-panels { grid-template-columns: 1fr; }
    }
    .preview-panel {
      padding: 16px;
      min-height: 200px;
      max-height: 360px;
      overflow-y: auto;
    }
    .preview-panel:first-child {
      border-right: 1px solid var(--color-border);
    }
    @media (max-width: 640px) {
      .preview-panel:first-child {
        border-right: none;
        border-bottom: 1px solid var(--color-border);
      }
    }
    .preview-panel__heading {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-secondary);
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--color-border);
    }
    .preview-panel__content {
      font-size: 13px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-wrap: break-word;
      color: var(--color-text);
      font-family: var(--font-mono);
    }
    .preview-panel--scrubbed .preview-panel__heading {
      color: var(--color-accent);
    }
    .preview-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: var(--color-text-secondary);
      font-size: 13px;
    }
    .preview-loading .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ─── Modal Footer ────────────────────────────────────────── */
    .modal__footer {
      padding: 16px 24px;
      border-top: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .modal__footer-left {
      font-size: 12px;
      color: var(--color-text-secondary);
    }
    .modal__footer-right {
      display: flex;
      gap: 8px;
    }

    /* ─── Success State ───────────────────────────────────────── */
    .publish-success {
      display: none;
      text-align: center;
      padding: 40px 24px;
    }
    .publish-success.active { display: block; }
    .publish-success__icon {
      width: 56px;
      height: 56px;
      background: var(--color-success-bg);
      color: var(--color-success);
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }
    .publish-success__icon svg { width: 28px; height: 28px; }
    .publish-success h3 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .publish-success p {
      color: var(--color-text-secondary);
      font-size: 14px;
      margin-bottom: 20px;
    }
    .url-copy-group {
      display: flex;
      gap: 8px;
      max-width: 500px;
      margin: 0 auto;
    }
    .url-copy-group input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      font-size: 13px;
      font-family: var(--font-mono);
      color: var(--color-text);
      background: #f9fafb;
    }
    .url-copy-group input:focus { outline: none; }

    /* ─── Error State ─────────────────────────────────────────── */
    .publish-error {
      display: none;
      padding: 10px 14px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      font-size: 13px;
      color: var(--color-danger);
      margin-top: 16px;
    }
    .publish-error.visible { display: block; }

    /* ─── Named Page Section ──────────────────────────────────── */
    .named-page-section {
      grid-column: 1 / -1;
    }
  </style>
</head>
<body>
  <!-- ─── Top Bar ──────────────────────────────────────────────────────── -->
  <div class="topbar">
    <div class="topbar__left">
      <span class="topbar__title">${escapeHtml(ctx.title)}</span>
      <span class="topbar__status topbar__status--${ctx.status.toLowerCase()}">${escapeHtml(ctx.status)}</span>
    </div>
    <div class="topbar__right">
      <button class="btn btn--sm" onclick="saveDraft()">Save Draft</button>
      <button class="btn btn--primary" id="publishBtn" onclick="openPublishModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
          <polyline points="16,6 12,2 8,6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
        Publish
      </button>
    </div>
  </div>

  <!-- ─── Editor Area ──────────────────────────────────────────────────── -->
  <div class="editor-area">
    <textarea id="editorBody">${escapeHtml(ctx.editableBody)}</textarea>
  </div>

  <!-- ─── Publish Modal ────────────────────────────────────────────────── -->
  <div class="modal-overlay" id="publishOverlay">
    <div class="modal" role="dialog" aria-labelledby="publishModalTitle">
      <!-- Header -->
      <div class="modal__header">
        <h2 id="publishModalTitle">Publish Landing Page</h2>
        <button class="modal__close" onclick="closePublishModal()" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Body: Settings Form -->
      <div class="modal__body" id="publishForm">
        <div class="publish-settings">
          <!-- Visibility Toggle -->
          <div class="field">
            <label class="field__label">Visibility</label>
            <div class="toggle-group" id="visibilityToggle">
              <button type="button" class="toggle-group__option active" data-value="PRIVATE" onclick="setVisibility('PRIVATE')">Private</button>
              <button type="button" class="toggle-group__option" data-value="SHARED_WITH_LINK" onclick="setVisibility('SHARED_WITH_LINK')">Shared with Link</button>
            </div>
            <span class="field__hint">Private pages are only visible to your team.</span>
          </div>

          <!-- Password -->
          <div class="field">
            <label class="field__label">Password Protection</label>
            <input type="password" class="text-input" id="publishPassword" placeholder="Leave empty for no password" minlength="4" maxlength="100" />
            <span class="field__hint">Optional. Must be 4+ characters if set.</span>
          </div>

          <!-- Expiration -->
          <div class="field">
            <label class="field__label">Expiration Date</label>
            <input type="datetime-local" class="text-input" id="publishExpiration" />
            <span class="field__hint">Optional. Link stops working after this date.</span>
          </div>

          <!-- Include Company Name Toggle (permission-gated) -->
          ${
            ctx.canPublishNamed
              ? `<div class="field named-page-section">
            <div class="toggle-row">
              <input type="checkbox" id="includeCompanyName" ${ctx.includeCompanyName ? "checked" : ""} onchange="onCompanyNameToggle()" />
              <div>
                <div class="toggle-row__label">Include company name</div>
                <div class="toggle-row__desc">Show the real company name instead of anonymizing it. Only use this with client permission.</div>
              </div>
            </div>
            <div class="warning-banner" id="companyNameWarning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              The real company name will be visible to anyone who views this page. Make sure you have permission from the client before enabling this.
            </div>
          </div>`
              : ""
          }
        </div>

        <!-- Side-by-Side Scrub Preview -->
        <div class="preview-section">
          <div class="preview-section__header">
            <span class="preview-section__title">Scrub Preview</span>
            <span class="preview-section__badge preview-section__badge--count" id="replacementCount"></span>
          </div>
          <div class="preview-panels" id="previewPanels">
            <div class="preview-loading" id="previewLoading">
              <div class="spinner"></div>
              Loading preview...
            </div>
          </div>
        </div>

        <!-- Error display -->
        <div class="publish-error" id="publishError"></div>
      </div>

      <!-- Body: Success State (hidden initially) -->
      <div class="publish-success" id="publishSuccess">
        <div class="publish-success__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
            <polyline points="22,4 12,14.01 9,11.01"/>
          </svg>
        </div>
        <h3>Published!</h3>
        <p>Your landing page is live. Share the URL below.</p>
        <div class="url-copy-group">
          <input type="text" id="shareableUrl" readonly />
          <button class="btn btn--primary btn--sm" onclick="copyUrl()">Copy</button>
        </div>
      </div>

      <!-- Footer -->
      <div class="modal__footer" id="publishFooter">
        <div class="modal__footer-left" id="footerHint">
          Review the scrub preview before publishing.
        </div>
        <div class="modal__footer-right">
          <button class="btn" onclick="closePublishModal()">Cancel</button>
          <button class="btn btn--primary" id="publishSubmitBtn" onclick="submitPublish()">
            Publish Page
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ─── Script ──────────────────────────────────────────────────────── -->
  <script>
    const PAGE_ID = ${JSON.stringify(ctx.pageId)};
    const API_BASE = '/api/pages/' + PAGE_ID;

    let currentVisibility = ${JSON.stringify(ctx.visibility)};
    let previewLoaded = false;

    // ── Modal open/close ─────────────────────────────────────────────

    function openPublishModal() {
      document.getElementById('publishOverlay').classList.add('active');
      document.getElementById('publishForm').style.display = '';
      document.getElementById('publishSuccess').classList.remove('active');
      document.getElementById('publishFooter').style.display = '';
      hideError();

      // Restore visibility toggle state
      setVisibility(currentVisibility);

      // Load scrub preview
      if (!previewLoaded) loadPreview();
    }

    function closePublishModal() {
      document.getElementById('publishOverlay').classList.remove('active');
    }

    // Close on overlay click
    document.getElementById('publishOverlay').addEventListener('click', function(e) {
      if (e.target === this) closePublishModal();
    });

    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closePublishModal();
    });

    // ── Visibility toggle ────────────────────────────────────────────

    function setVisibility(value) {
      currentVisibility = value;
      var btns = document.querySelectorAll('#visibilityToggle .toggle-group__option');
      btns.forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-value') === value);
      });
    }

    // ── Company name toggle ──────────────────────────────────────────

    function onCompanyNameToggle() {
      var cb = document.getElementById('includeCompanyName');
      var warning = document.getElementById('companyNameWarning');
      if (cb && warning) {
        warning.classList.toggle('visible', cb.checked);
      }
      // Reload preview with the new toggle state
      loadPreview();
    }

    // Initialize warning state
    (function() {
      var cb = document.getElementById('includeCompanyName');
      var warning = document.getElementById('companyNameWarning');
      if (cb && warning && cb.checked) {
        warning.classList.add('visible');
      }
    })();

    // ── Load scrub preview ───────────────────────────────────────────

    async function loadPreview() {
      var panels = document.getElementById('previewPanels');
      var countBadge = document.getElementById('replacementCount');

      panels.innerHTML = '<div class="preview-loading" id="previewLoading"><div class="spinner"></div>Loading preview...</div>';

      try {
        var resp = await fetch(API_BASE + '/preview-scrub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!resp.ok) throw new Error('Failed to load preview');

        var data = await resp.json();
        previewLoaded = true;

        var originalBody = data.original.body || '';
        var scrubbedBody = data.scrubbed.body || '';
        var count = data.replacements_made || 0;

        countBadge.textContent = count + ' replacement' + (count !== 1 ? 's' : '');

        panels.innerHTML =
          '<div class="preview-panel preview-panel--original">' +
            '<div class="preview-panel__heading">Original</div>' +
            '<div class="preview-panel__content" id="originalContent"></div>' +
          '</div>' +
          '<div class="preview-panel preview-panel--scrubbed">' +
            '<div class="preview-panel__heading">Scrubbed (Published Version)</div>' +
            '<div class="preview-panel__content" id="scrubbedContent"></div>' +
          '</div>';

        // Use textContent to safely set content (no XSS)
        document.getElementById('originalContent').textContent = truncatePreview(originalBody, 3000);
        document.getElementById('scrubbedContent').textContent = truncatePreview(scrubbedBody, 3000);

      } catch (err) {
        panels.innerHTML = '<div class="preview-loading">Failed to load preview. Try again.</div>';
      }
    }

    function truncatePreview(text, maxLen) {
      if (text.length <= maxLen) return text;
      return text.slice(0, maxLen) + '\\n\\n... (truncated)';
    }

    // ── Submit publish ───────────────────────────────────────────────

    async function submitPublish() {
      hideError();
      var btn = document.getElementById('publishSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Publishing...';

      var password = document.getElementById('publishPassword').value.trim();
      var expiration = document.getElementById('publishExpiration').value;

      // Validate password length if provided
      if (password && password.length < 4) {
        showError('Password must be at least 4 characters.');
        btn.disabled = false;
        btn.textContent = 'Publish Page';
        return;
      }

      var body = {
        visibility: currentVisibility,
      };
      if (password) body.password = password;
      if (expiration) body.expires_at = new Date(expiration).toISOString();

      try {
        var resp = await fetch(API_BASE + '/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        var data = await resp.json();

        if (!resp.ok) {
          var msg = data.message || data.error || 'Publish failed';
          if (data.details) msg += ': ' + data.details.map(function(d) { return d.message; }).join(', ');
          showError(msg);
          btn.disabled = false;
          btn.textContent = 'Publish Page';
          return;
        }

        // Show success state
        document.getElementById('publishForm').style.display = 'none';
        document.getElementById('publishSuccess').classList.add('active');
        document.getElementById('shareableUrl').value = data.url;
        document.getElementById('publishFooter').style.display = 'none';

        // Update topbar status
        var statusEl = document.querySelector('.topbar__status');
        statusEl.className = 'topbar__status topbar__status--published';
        statusEl.textContent = 'PUBLISHED';

      } catch (err) {
        showError('Network error. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Publish Page';
      }
    }

    // ── Copy URL ─────────────────────────────────────────────────────

    function copyUrl() {
      var input = document.getElementById('shareableUrl');
      input.select();
      navigator.clipboard.writeText(input.value).then(function() {
        var copyBtn = input.nextElementSibling;
        copyBtn.textContent = 'Copied!';
        setTimeout(function() { copyBtn.textContent = 'Copy'; }, 2000);
      });
    }

    // ── Save draft ───────────────────────────────────────────────────

    async function saveDraft() {
      var body = document.getElementById('editorBody').value;
      try {
        await fetch(API_BASE, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editable_body: body }),
        });
      } catch (err) {
        console.error('Save failed:', err);
      }
    }

    // ── Error helpers ────────────────────────────────────────────────

    function showError(msg) {
      var el = document.getElementById('publishError');
      el.textContent = msg;
      el.classList.add('visible');
    }

    function hideError() {
      document.getElementById('publishError').classList.remove('visible');
    }
  </script>
</body>
</html>`;
}

// ─── Error Pages ──────────────────────────────────────────────────────────

function render404(): string {
  return `<!DOCTYPE html><html><head><meta name="robots" content="noindex"><title>Not Found</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fafafa}h1{color:#555}</style></head><body><h1>Page not found</h1></body></html>`;
}

// ─── Utility ──────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
