/**
 * Chatbot Connector — Embedded Chat Interface
 *
 * Serves a server-rendered chat page at /chat that provides:
 *   - Account context selector (or "All Accounts" cross-search)
 *   - Chat-style message thread
 *   - Source citations as expandable cards with transcript snippets + call metadata
 *   - Follow-up questions carrying conversation history
 *
 * The page is an authenticated view for org members, styled to match
 * the existing landing page design language.
 */

import { Router, type Request, type Response } from "express";
import type { UserRole } from "@prisma/client";

interface AuthReq extends Request {
  organizationId?: string;
  userId?: string;
  userRole?: UserRole;
}

// ─── Route Factory ──────────────────────────────────────────────────────────

export function createChatbotConnectorRoutes(): Router {
  const router = Router();

  /**
   * GET /chat
   *
   * Renders the embedded chatbot connector interface.
   * Requires authentication (organizationId set by auth middleware).
   */
  router.get("/", (req: AuthReq, res: Response) => {
    if (!req.organizationId || !req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    res.setHeader("Cache-Control", "private, no-cache");
    res.send(renderChatPage(req.organizationId));
  });

  return router;
}

// ─── HTML Renderer ──────────────────────────────────────────────────────────

function renderChatPage(organizationId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Chatbot Connector — StoryEngine</title>
  <style>
    /* ─── Reset & Base ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #f8f9fb;
      --color-surface: #ffffff;
      --color-text: #1a1a2e;
      --color-text-secondary: #555770;
      --color-text-tertiary: #8e90a6;
      --color-accent: #4f46e5;
      --color-accent-hover: #4338ca;
      --color-accent-light: #eef2ff;
      --color-border: #e5e7eb;
      --color-border-light: #f0f0f5;
      --color-user-bubble: #4f46e5;
      --color-user-text: #ffffff;
      --color-assistant-bubble: #ffffff;
      --color-assistant-text: #1a1a2e;
      --color-source-bg: #f9fafb;
      --color-source-border: #e5e7eb;
      --color-source-accent: #7c3aed;
      --color-empty-state: #c4c6d0;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.04);
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
      height: 100vh;
      overflow: hidden;
    }

    /* ─── Layout ─────────────────────────────────────────────────── */
    .app {
      display: flex;
      flex-direction: column;
      height: 100vh;
      max-width: 900px;
      margin: 0 auto;
    }

    /* ─── Header ─────────────────────────────────────────────────── */
    .header {
      padding: 16px 24px;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      gap: 16px;
      flex-shrink: 0;
    }
    .header__logo {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .header__logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .header__logo-icon svg { width: 18px; height: 18px; color: white; }
    .header__title {
      font-size: 15px;
      font-weight: 600;
      color: var(--color-text);
    }
    .header__subtitle {
      font-size: 12px;
      color: var(--color-text-tertiary);
    }
    .header__divider {
      width: 1px;
      height: 32px;
      background: var(--color-border);
    }

    /* ─── Account Selector ────────────────────────────────────────── */
    .account-selector {
      position: relative;
      flex: 1;
      max-width: 360px;
    }
    .account-selector__trigger {
      width: 100%;
      padding: 8px 36px 8px 12px;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      font-family: var(--font-sans);
      font-size: 13px;
      color: var(--color-text);
      cursor: pointer;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: border-color 0.15s;
    }
    .account-selector__trigger:hover { border-color: var(--color-accent); }
    .account-selector__trigger::after {
      content: '';
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      border: 5px solid transparent;
      border-top-color: var(--color-text-secondary);
    }
    .account-selector__dropdown {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      z-index: 100;
      max-height: 320px;
      overflow: hidden;
    }
    .account-selector__dropdown.open { display: block; }
    .account-selector__search {
      width: 100%;
      padding: 10px 12px;
      border: none;
      border-bottom: 1px solid var(--color-border-light);
      font-family: var(--font-sans);
      font-size: 13px;
      outline: none;
      background: transparent;
    }
    .account-selector__list {
      max-height: 260px;
      overflow-y: auto;
    }
    .account-selector__option {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.1s;
    }
    .account-selector__option:hover { background: var(--color-accent-light); }
    .account-selector__option.selected { background: var(--color-accent-light); color: var(--color-accent); font-weight: 500; }
    .account-selector__option-meta {
      font-size: 11px;
      color: var(--color-text-tertiary);
    }
    .account-selector__empty {
      padding: 16px 12px;
      text-align: center;
      color: var(--color-text-tertiary);
      font-size: 13px;
    }

    /* ─── Chat Thread ────────────────────────────────────────────── */
    .chat-thread {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--color-empty-state);
    }
    .empty-state svg { width: 48px; height: 48px; opacity: 0.5; }
    .empty-state__title {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text-secondary);
    }
    .empty-state__hint {
      font-size: 13px;
      color: var(--color-text-tertiary);
      text-align: center;
      max-width: 340px;
    }
    .empty-state__suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
      justify-content: center;
    }
    .empty-state__suggestion {
      padding: 6px 14px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 20px;
      font-size: 12px;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }
    .empty-state__suggestion:hover {
      border-color: var(--color-accent);
      color: var(--color-accent);
      background: var(--color-accent-light);
    }

    /* ─── Messages ───────────────────────────────────────────────── */
    .message { display: flex; gap: 12px; max-width: 100%; }
    .message--user { flex-direction: row-reverse; }

    .message__avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 600;
    }
    .message--user .message__avatar {
      background: var(--color-accent);
      color: white;
    }
    .message--assistant .message__avatar {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: white;
    }
    .message--assistant .message__avatar svg { width: 16px; height: 16px; }

    .message__body { max-width: 680px; min-width: 0; }

    .message__bubble {
      padding: 12px 16px;
      border-radius: var(--radius-md);
      font-size: 14px;
      line-height: 1.6;
      word-wrap: break-word;
    }
    .message--user .message__bubble {
      background: var(--color-user-bubble);
      color: var(--color-user-text);
      border-bottom-right-radius: 4px;
    }
    .message--assistant .message__bubble {
      background: var(--color-assistant-bubble);
      color: var(--color-assistant-text);
      border: 1px solid var(--color-border);
      border-bottom-left-radius: 4px;
      box-shadow: var(--shadow-sm);
    }

    /* Source citation references in assistant text */
    .message__bubble .source-ref {
      display: inline-block;
      background: var(--color-accent-light);
      color: var(--color-accent);
      font-size: 11px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
      cursor: pointer;
      vertical-align: middle;
    }
    .message__bubble .source-ref:hover {
      background: var(--color-accent);
      color: white;
    }

    /* ─── Source Citations ────────────────────────────────────────── */
    .sources {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sources__label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-tertiary);
      margin-bottom: 2px;
    }
    .source-card {
      background: var(--color-source-bg);
      border: 1px solid var(--color-source-border);
      border-radius: var(--radius-sm);
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .source-card:hover { border-color: var(--color-source-accent); }
    .source-card__header {
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .source-card__expand {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      transition: transform 0.2s;
      color: var(--color-text-tertiary);
    }
    .source-card.expanded .source-card__expand { transform: rotate(90deg); }
    .source-card__badge {
      background: var(--color-accent-light);
      color: var(--color-accent);
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .source-card__title {
      font-size: 12px;
      font-weight: 500;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .source-card__meta {
      font-size: 11px;
      color: var(--color-text-tertiary);
      flex-shrink: 0;
      white-space: nowrap;
    }
    .source-card__relevance {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 10px;
      flex-shrink: 0;
    }
    .source-card__relevance--high { background: #ecfdf5; color: #059669; }
    .source-card__relevance--medium { background: #fffbeb; color: #d97706; }
    .source-card__relevance--low { background: #fef2f2; color: #dc2626; }

    .source-card__content {
      display: none;
      padding: 0 12px 10px;
      border-top: 1px solid var(--color-border-light);
    }
    .source-card.expanded .source-card__content { display: block; }
    .source-card__speaker {
      font-size: 11px;
      font-weight: 600;
      color: var(--color-source-accent);
      margin: 8px 0 4px;
    }
    .source-card__text {
      font-size: 13px;
      color: var(--color-text-secondary);
      line-height: 1.55;
      font-style: italic;
      background: white;
      padding: 8px 10px;
      border-radius: 6px;
      border-left: 3px solid var(--color-source-accent);
    }
    .source-card__call-meta {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .source-card__call-meta-item {
      font-size: 11px;
      color: var(--color-text-tertiary);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .source-card__call-meta-item svg { width: 12px; height: 12px; }

    /* ─── Typing Indicator ───────────────────────────────────────── */
    .typing-indicator {
      display: flex;
      gap: 4px;
      padding: 8px 0;
    }
    .typing-indicator span {
      width: 6px;
      height: 6px;
      background: var(--color-text-tertiary);
      border-radius: 50%;
      animation: typing-bounce 1.4s infinite ease-in-out both;
    }
    .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
    .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes typing-bounce {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    /* ─── Input Area ─────────────────────────────────────────────── */
    .input-area {
      padding: 16px 24px;
      background: var(--color-surface);
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .input-area__wrapper {
      display: flex;
      gap: 8px;
      align-items: flex-end;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      padding: 4px;
      transition: border-color 0.15s;
    }
    .input-area__wrapper:focus-within { border-color: var(--color-accent); }
    .input-area__textarea {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      font-family: var(--font-sans);
      font-size: 14px;
      color: var(--color-text);
      resize: none;
      padding: 8px 8px 8px 12px;
      max-height: 120px;
      line-height: 1.5;
    }
    .input-area__textarea::placeholder { color: var(--color-text-tertiary); }
    .input-area__send {
      width: 36px;
      height: 36px;
      background: var(--color-accent);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .input-area__send:hover { background: var(--color-accent-hover); }
    .input-area__send:disabled { background: var(--color-border); cursor: not-allowed; }
    .input-area__send svg { width: 18px; height: 18px; }
    .input-area__context {
      font-size: 11px;
      color: var(--color-text-tertiary);
      margin-top: 6px;
      padding-left: 4px;
    }

    /* ─── Responsive ─────────────────────────────────────────────── */
    @media (max-width: 640px) {
      .header { padding: 12px 16px; gap: 10px; }
      .header__subtitle { display: none; }
      .header__divider { display: none; }
      .chat-thread { padding: 16px; }
      .input-area { padding: 12px 16px; }
      .account-selector { max-width: none; }
      .message__body { max-width: calc(100vw - 80px); }
    }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="app">
    <!-- Header with account selector -->
    <div class="header">
      <div class="header__logo">
        <div class="header__logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div>
          <div class="header__title">Chatbot Connector</div>
          <div class="header__subtitle">Ask questions about call transcripts</div>
        </div>
      </div>

      <div class="header__divider"></div>

      <div class="account-selector">
        <button class="account-selector__trigger" id="accountTrigger">
          All Accounts
        </button>
        <div class="account-selector__dropdown" id="accountDropdown">
          <input
            type="text"
            class="account-selector__search"
            id="accountSearch"
            placeholder="Search accounts..."
          />
          <div class="account-selector__list" id="accountList">
            <div class="account-selector__option selected" data-id="">
              All Accounts
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Chat message thread -->
    <div class="chat-thread" id="chatThread">
      <div class="empty-state" id="emptyState">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          <path d="M8 9h8M8 13h4"/>
        </svg>
        <div class="empty-state__title">Ask anything about your calls</div>
        <div class="empty-state__hint">
          Query transcript data across accounts using natural language.
          Select an account above to focus your search, or search across all.
        </div>
        <div class="empty-state__suggestions">
          <button class="empty-state__suggestion" data-query="What were the main pain points discussed?">Pain points</button>
          <button class="empty-state__suggestion" data-query="What ROI metrics were mentioned?">ROI metrics</button>
          <button class="empty-state__suggestion" data-query="How was the onboarding experience?">Onboarding</button>
          <button class="empty-state__suggestion" data-query="What competitors were mentioned?">Competitors</button>
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div class="input-area">
      <div class="input-area__wrapper">
        <textarea
          class="input-area__textarea"
          id="chatInput"
          placeholder="Ask a question about call transcripts..."
          rows="1"
        ></textarea>
        <button class="input-area__send" id="sendBtn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22,2 15,22 11,13 2,9"/>
          </svg>
        </button>
      </div>
      <div class="input-area__context" id="contextInfo">
        Searching across all accounts
      </div>
    </div>
  </div>

  <script>
    // ─── State ──────────────────────────────────────────────────────────────────
    const ORG_ID = ${JSON.stringify(organizationId)};
    let selectedAccountId = null;
    let selectedAccountName = 'All Accounts';
    let conversationHistory = []; // {role, content}[]
    let accounts = [];
    let isLoading = false;

    // ─── DOM References ─────────────────────────────────────────────────────────
    const chatThread = document.getElementById('chatThread');
    const emptyState = document.getElementById('emptyState');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const accountTrigger = document.getElementById('accountTrigger');
    const accountDropdown = document.getElementById('accountDropdown');
    const accountSearch = document.getElementById('accountSearch');
    const accountList = document.getElementById('accountList');
    const contextInfo = document.getElementById('contextInfo');

    // ─── Account Selector ───────────────────────────────────────────────────────
    async function loadAccounts(search) {
      const params = new URLSearchParams();
      if (search) params.set('search', search);

      try {
        const res = await fetch('/api/rag/accounts?' + params.toString(), {
          credentials: 'same-origin'
        });
        if (!res.ok) return;
        const data = await res.json();
        accounts = data.accounts || [];
        renderAccountList();
      } catch (e) {
        console.error('Failed to load accounts:', e);
      }
    }

    function renderAccountList(filter) {
      const filtered = filter
        ? accounts.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
        : accounts;

      let html = '<div class="account-selector__option' +
        (selectedAccountId === null ? ' selected' : '') +
        '" data-id="">All Accounts</div>';

      if (filtered.length === 0 && filter) {
        html += '<div class="account-selector__empty">No accounts found</div>';
      } else {
        for (const a of filtered) {
          const sel = a.id === selectedAccountId ? ' selected' : '';
          const meta = [a.domain, a.call_count + ' calls'].filter(Boolean).join(' · ');
          html += '<div class="account-selector__option' + sel + '" data-id="' + escapeAttr(a.id) + '">' +
            '<span>' + escapeHtml(a.name) + '</span>' +
            '<span class="account-selector__option-meta">' + escapeHtml(meta) + '</span>' +
            '</div>';
        }
      }

      accountList.innerHTML = html;
      attachAccountOptionListeners();
    }

    function attachAccountOptionListeners() {
      for (const opt of accountList.querySelectorAll('.account-selector__option')) {
        opt.addEventListener('click', function() {
          const id = this.dataset.id || null;
          const name = id
            ? accounts.find(a => a.id === id)?.name || 'Unknown'
            : 'All Accounts';
          selectAccount(id, name);
        });
      }
    }

    function selectAccount(id, name) {
      selectedAccountId = id;
      selectedAccountName = name;
      accountTrigger.textContent = name;
      accountDropdown.classList.remove('open');
      contextInfo.textContent = id
        ? 'Searching within ' + name
        : 'Searching across all accounts';

      // Reset conversation when switching accounts
      conversationHistory = [];
      chatThread.innerHTML = '';
      chatThread.appendChild(emptyState);
      emptyState.style.display = 'flex';
    }

    accountTrigger.addEventListener('click', function(e) {
      e.stopPropagation();
      const isOpen = accountDropdown.classList.toggle('open');
      if (isOpen) {
        accountSearch.value = '';
        accountSearch.focus();
        loadAccounts();
      }
    });

    accountSearch.addEventListener('input', function() {
      renderAccountList(this.value);
    });

    document.addEventListener('click', function(e) {
      if (!accountDropdown.contains(e.target) && e.target !== accountTrigger) {
        accountDropdown.classList.remove('open');
      }
    });

    // ─── Chat Input ─────────────────────────────────────────────────────────────
    chatInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      sendBtn.disabled = !this.value.trim() || isLoading;
    });

    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendMessage();
      }
    });

    sendBtn.addEventListener('click', sendMessage);

    // Suggestion chips
    for (const btn of document.querySelectorAll('.empty-state__suggestion')) {
      btn.addEventListener('click', function() {
        chatInput.value = this.dataset.query;
        chatInput.dispatchEvent(new Event('input'));
        sendMessage();
      });
    }

    // ─── Send Message ───────────────────────────────────────────────────────────
    async function sendMessage() {
      const query = chatInput.value.trim();
      if (!query || isLoading) return;

      isLoading = true;
      sendBtn.disabled = true;
      chatInput.value = '';
      chatInput.style.height = 'auto';

      // Hide empty state
      emptyState.style.display = 'none';

      // Render user message
      appendMessage('user', query);

      // Show typing indicator
      const typingEl = appendTypingIndicator();

      try {
        const res = await fetch('/api/rag/chat', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: query,
            account_id: selectedAccountId,
            history: conversationHistory,
            top_k: 8,
          }),
        });

        typingEl.remove();

        if (!res.ok) {
          const err = await res.json().catch(function() { return { error: 'Request failed' }; });
          appendMessage('assistant', 'Sorry, something went wrong: ' + (err.error || 'Unknown error'), []);
          isLoading = false;
          sendBtn.disabled = !chatInput.value.trim();
          return;
        }

        const data = await res.json();

        // Update conversation history
        conversationHistory.push({ role: 'user', content: query });
        conversationHistory.push({ role: 'assistant', content: data.answer });

        // Render assistant message with sources
        appendMessage('assistant', data.answer, data.sources || []);
      } catch (e) {
        typingEl.remove();
        appendMessage('assistant', 'Sorry, a network error occurred. Please try again.', []);
      }

      isLoading = false;
      sendBtn.disabled = !chatInput.value.trim();
    }

    // ─── Render Messages ────────────────────────────────────────────────────────
    function appendMessage(role, content, sources) {
      const msgEl = document.createElement('div');
      msgEl.className = 'message message--' + role;

      const avatarEl = document.createElement('div');
      avatarEl.className = 'message__avatar';

      if (role === 'user') {
        avatarEl.textContent = 'Y';
      } else {
        avatarEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4c0 1.1-.9 2-2 2h-4a2 2 0 01-2-2 4 4 0 014-4z"/><path d="M8 8v8a4 4 0 004 4h0a4 4 0 004-4V8"/></svg>';
      }

      const bodyEl = document.createElement('div');
      bodyEl.className = 'message__body';

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'message__bubble';

      // Format content — replace [Source N] references with styled spans
      let html = escapeHtml(content);
      html = html.replace(
        /\\[Source\\s*(\\d+)\\]/g,
        '<span class="source-ref" data-source="$1">[Source $1]</span>'
      );
      // Basic paragraph breaks
      html = html.replace(/\\n\\n/g, '</p><p>');
      html = html.replace(/\\n/g, '<br>');
      html = '<p>' + html + '</p>';
      html = html.replace(/<p><\\/p>/g, '');
      bubbleEl.innerHTML = html;

      bodyEl.appendChild(bubbleEl);

      // Render source citations
      if (sources && sources.length > 0) {
        const sourcesEl = document.createElement('div');
        sourcesEl.className = 'sources';

        const labelEl = document.createElement('div');
        labelEl.className = 'sources__label';
        labelEl.textContent = sources.length + ' source' + (sources.length !== 1 ? 's' : '');
        sourcesEl.appendChild(labelEl);

        sources.forEach(function(src, i) {
          sourcesEl.appendChild(createSourceCard(src, i + 1));
        });

        bodyEl.appendChild(sourcesEl);
      }

      msgEl.appendChild(avatarEl);
      msgEl.appendChild(bodyEl);
      chatThread.appendChild(msgEl);
      chatThread.scrollTop = chatThread.scrollHeight;
    }

    function createSourceCard(source, index) {
      const card = document.createElement('div');
      card.className = 'source-card';

      // Relevance class
      const score = source.relevance_score || 0;
      let relevanceClass = 'low';
      let relevanceLabel = Math.round(score * 100) + '%';
      if (score >= 0.85) relevanceClass = 'high';
      else if (score >= 0.7) relevanceClass = 'medium';

      card.innerHTML =
        '<div class="source-card__header">' +
          '<svg class="source-card__expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>' +
          '<span class="source-card__badge">S' + index + '</span>' +
          '<span class="source-card__title">' + escapeHtml(source.call_title || 'Untitled Call') + '</span>' +
          '<span class="source-card__meta">' + escapeHtml(source.call_date || '') + '</span>' +
          '<span class="source-card__relevance source-card__relevance--' + relevanceClass + '">' + relevanceLabel + '</span>' +
        '</div>' +
        '<div class="source-card__content">' +
          (source.speaker ? '<div class="source-card__speaker">' + escapeHtml(source.speaker) + '</div>' : '') +
          '<div class="source-card__text">' + escapeHtml(source.text || '') + '</div>' +
          '<div class="source-card__call-meta">' +
            '<span class="source-card__call-meta-item">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
              escapeHtml(source.call_date || 'Unknown date') +
            '</span>' +
            '<span class="source-card__call-meta-item">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
              escapeHtml(source.speaker || 'Unknown speaker') +
            '</span>' +
            '<span class="source-card__call-meta-item">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>' +
              'ID: ' + escapeHtml((source.call_id || '').slice(0, 8)) +
            '</span>' +
          '</div>' +
        '</div>';

      // Toggle expand
      card.querySelector('.source-card__header').addEventListener('click', function() {
        card.classList.toggle('expanded');
      });

      return card;
    }

    function appendTypingIndicator() {
      const msgEl = document.createElement('div');
      msgEl.className = 'message message--assistant';
      msgEl.id = 'typingMsg';

      msgEl.innerHTML =
        '<div class="message__avatar">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4c0 1.1-.9 2-2 2h-4a2 2 0 01-2-2 4 4 0 014-4z"/><path d="M8 8v8a4 4 0 004 4h0a4 4 0 004-4V8"/></svg>' +
        '</div>' +
        '<div class="message__body">' +
          '<div class="message__bubble">' +
            '<div class="typing-indicator"><span></span><span></span><span></span></div>' +
          '</div>' +
        '</div>';

      chatThread.appendChild(msgEl);
      chatThread.scrollTop = chatThread.scrollHeight;
      return msgEl;
    }

    // ─── Utilities ──────────────────────────────────────────────────────────────
    function escapeHtml(str) {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function escapeAttr(str) {
      return escapeHtml(str);
    }

    // ─── Init ───────────────────────────────────────────────────────────────────
    loadAccounts();
  </script>
</body>
</html>`;
}
