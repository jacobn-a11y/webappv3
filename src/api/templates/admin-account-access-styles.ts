/**
 * Admin Account Access Page — CSS Styles
 *
 * Contains all CSS for the server-rendered account access management page.
 */

export function getAccountAccessStyles(): string {
  return `
    /* ─── Reset & Base ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #f8f9fb;
      --color-surface: #ffffff;
      --color-text: #1a1a2e;
      --color-text-secondary: #555770;
      --color-text-muted: #8b8da3;
      --color-accent: #4f46e5;
      --color-accent-hover: #4338ca;
      --color-accent-light: #eef2ff;
      --color-border: #e5e7eb;
      --color-border-light: #f0f0f5;
      --color-green: #059669;
      --color-green-bg: #ecfdf5;
      --color-green-border: #a7f3d0;
      --color-red: #dc2626;
      --color-red-bg: #fef2f2;
      --color-red-hover: #b91c1c;
      --color-orange: #d97706;
      --color-orange-bg: #fffbeb;
      --color-blue: #2563eb;
      --color-blue-bg: #eff6ff;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --radius: 8px;
      --radius-lg: 12px;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
      --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
    }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Layout ────────────────────────────────────────────────── */
    .page-container {
      max-width: 1080px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }

    .page-header {
      margin-bottom: 2rem;
    }
    .page-header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text);
      margin-bottom: 0.25rem;
    }
    .page-header p {
      color: var(--color-text-secondary);
      font-size: 0.9rem;
    }

    /* ─── Loading / Error ───────────────────────────────────────── */
    .loading-state, .error-state {
      text-align: center;
      padding: 4rem 1rem;
      color: var(--color-text-secondary);
    }
    .loading-spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid var(--color-border);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-bottom: 0.75rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error-state { color: var(--color-red); }
    .error-state button {
      margin-top: 1rem;
      background: var(--color-accent);
      color: white;
      border: none;
      padding: 0.5rem 1.25rem;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
    }

    /* ─── User Cards ────────────────────────────────────────────── */
    .user-list { display: flex; flex-direction: column; gap: 1rem; }

    .user-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }

    .user-card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--color-border-light);
      gap: 1rem;
    }

    .user-card__info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }

    .user-card__avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--color-accent-light);
      color: var(--color-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .user-card__name {
      font-weight: 600;
      font-size: 0.95rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .user-card__email {
      color: var(--color-text-secondary);
      font-size: 0.8rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-card__role {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .role--owner, .role--admin {
      background: var(--color-accent-light);
      color: var(--color-accent);
    }
    .role--member {
      background: var(--color-blue-bg);
      color: var(--color-blue);
    }
    .role--viewer {
      background: #f5f5f5;
      color: var(--color-text-secondary);
    }

    .user-card__actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    /* ─── Grants Section ────────────────────────────────────────── */
    .user-card__grants {
      padding: 1rem 1.25rem;
    }

    .grants-empty {
      color: var(--color-text-muted);
      font-size: 0.85rem;
      font-style: italic;
      padding: 0.5rem 0;
    }

    .grant-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 0.75rem;
      margin: 0.35rem 0;
      border-radius: var(--radius);
      background: var(--color-bg);
      gap: 0.75rem;
    }

    .grant-row__info {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-width: 0;
      flex: 1;
    }

    /* ─── Scope Badges ──────────────────────────────────────────── */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 0.25rem 0.65rem;
      border-radius: 20px;
      white-space: nowrap;
    }

    .badge--all {
      background: var(--color-green-bg);
      color: var(--color-green);
      border: 1px solid var(--color-green-border);
    }
    .badge--all::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--color-green);
    }

    .badge--account {
      background: var(--color-blue-bg);
      color: var(--color-blue);
      border: 1px solid #bfdbfe;
    }

    .badge--list {
      background: var(--color-orange-bg);
      color: var(--color-orange);
      border: 1px solid #fde68a;
    }

    .badge--crm {
      background: #f5f3ff;
      color: #7c3aed;
      border: 1px solid #ddd6fe;
    }

    .grant-row__meta {
      font-size: 0.78rem;
      color: var(--color-text-muted);
      white-space: nowrap;
    }

    .grant-row__accounts {
      font-size: 0.82rem;
      color: var(--color-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .crm-sync-info {
      font-size: 0.78rem;
      color: var(--color-text-muted);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* ─── Buttons ───────────────────────────────────────────────── */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-family: var(--font-sans);
      font-size: 0.8rem;
      font-weight: 500;
      padding: 0.4rem 0.85rem;
      border-radius: var(--radius);
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .btn:hover {
      background: var(--color-bg);
      border-color: #d1d5db;
    }

    .btn--primary {
      background: var(--color-accent);
      color: white;
      border-color: var(--color-accent);
    }
    .btn--primary:hover {
      background: var(--color-accent-hover);
      border-color: var(--color-accent-hover);
    }

    .btn--danger {
      color: var(--color-red);
      border-color: transparent;
      background: transparent;
      padding: 0.3rem 0.5rem;
      font-size: 0.75rem;
    }
    .btn--danger:hover {
      background: var(--color-red-bg);
    }

    .btn--sync {
      color: var(--color-accent);
      border-color: transparent;
      background: transparent;
      padding: 0.3rem 0.5rem;
      font-size: 0.75rem;
    }
    .btn--sync:hover {
      background: var(--color-accent-light);
    }

    .btn--sm {
      font-size: 0.75rem;
      padding: 0.3rem 0.65rem;
    }

    .btn svg {
      width: 14px;
      height: 14px;
    }

    /* ─── Modal ─────────────────────────────────────────────────── */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .modal-overlay.active { display: flex; }

    .modal {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      width: 100%;
      max-width: 520px;
      max-height: 85vh;
      overflow-y: auto;
    }

    .modal__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--color-border);
    }
    .modal__header h2 {
      font-size: 1.1rem;
      font-weight: 600;
    }
    .modal__close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-text-secondary);
      padding: 0.25rem;
      border-radius: 4px;
      display: flex;
    }
    .modal__close:hover { background: var(--color-bg); }

    .modal__body { padding: 1.5rem; }

    .modal__footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--color-border);
    }

    /* ─── Tabs ──────────────────────────────────────────────────── */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--color-border);
      margin-bottom: 1.25rem;
    }
    .tab {
      padding: 0.6rem 1rem;
      font-size: 0.82rem;
      font-weight: 500;
      color: var(--color-text-secondary);
      cursor: pointer;
      border: none;
      background: none;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
      font-family: var(--font-sans);
    }
    .tab:hover { color: var(--color-text); }
    .tab.active {
      color: var(--color-accent);
      border-bottom-color: var(--color-accent);
    }

    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ─── Form Elements ─────────────────────────────────────────── */
    .form-group { margin-bottom: 1rem; }
    .form-group label {
      display: block;
      font-size: 0.82rem;
      font-weight: 500;
      margin-bottom: 0.35rem;
      color: var(--color-text);
    }
    .form-group .hint {
      font-size: 0.75rem;
      color: var(--color-text-muted);
      margin-top: 0.25rem;
    }

    .search-input-wrap {
      position: relative;
    }
    .search-input-wrap svg {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--color-text-muted);
      pointer-events: none;
    }

    input[type="text"], input[type="search"], select {
      width: 100%;
      padding: 0.55rem 0.75rem;
      font-family: var(--font-sans);
      font-size: 0.85rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: var(--color-surface);
      color: var(--color-text);
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus, select:focus {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px rgba(79,70,229,0.1);
    }
    .search-input-wrap input {
      padding-left: 2rem;
    }

    /* ─── Account Search Results ─────────────────────────────────── */
    .search-results {
      border: 1px solid var(--color-border);
      border-top: none;
      border-radius: 0 0 var(--radius) var(--radius);
      max-height: 200px;
      overflow-y: auto;
      display: none;
    }
    .search-results.active { display: block; }

    .search-result-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      font-size: 0.85rem;
      transition: background 0.1s;
    }
    .search-result-item:hover { background: var(--color-accent-light); }
    .search-result-item__name { font-weight: 500; }
    .search-result-item__domain {
      font-size: 0.75rem;
      color: var(--color-text-muted);
    }

    /* ─── Selected Accounts (multi-select) ──────────────────────── */
    .selected-accounts {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.5rem;
      min-height: 32px;
    }
    .selected-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: var(--color-accent-light);
      color: var(--color-accent);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.78rem;
      font-weight: 500;
    }
    .selected-tag button {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-accent);
      padding: 0;
      font-size: 1rem;
      line-height: 1;
      display: flex;
    }
    .selected-tag button:hover { color: var(--color-red); }

    /* ─── CRM Report Section ────────────────────────────────────── */
    .provider-toggle {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .provider-btn {
      flex: 1;
      padding: 0.6rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: var(--color-surface);
      font-family: var(--font-sans);
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .provider-btn:hover { border-color: var(--color-accent); }
    .provider-btn.active {
      border-color: var(--color-accent);
      background: var(--color-accent-light);
      color: var(--color-accent);
    }

    .reports-loading, .reports-empty {
      text-align: center;
      padding: 1.5rem;
      color: var(--color-text-muted);
      font-size: 0.85rem;
    }

    /* ─── Toast Notifications ───────────────────────────────────── */
    .toast-container {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      box-shadow: var(--shadow-md);
      font-size: 0.85rem;
      animation: toast-in 0.3s ease-out;
      max-width: 360px;
    }
    .toast--success { border-left: 3px solid var(--color-green); }
    .toast--error { border-left: 3px solid var(--color-red); }
    @keyframes toast-in {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }

    /* ─── Responsive ────────────────────────────────────────────── */
    @media (max-width: 640px) {
      .page-container { padding: 1.25rem 1rem 3rem; }
      .user-card__header { flex-wrap: wrap; }
      .user-card__actions { width: 100%; justify-content: flex-end; }
      .grant-row { flex-wrap: wrap; }
      .grant-row__meta { width: 100%; }
    }
  `;
}
