import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  getChatAccounts,
  sendChatMessage,
  type ChatAccount,
  type ChatSource,
} from "../lib/api";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

let messageIdCounter = 0;
function nextMessageId(): string {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

function relevanceLevel(score: number): { label: string; className: string } {
  if (score >= 0.85) return { label: "High", className: "chat__relevance--high" };
  if (score >= 0.7) return { label: "Medium", className: "chat__relevance--medium" };
  return { label: "Low", className: "chat__relevance--low" };
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// ─── Suggestion Chips ───────────────────────────────────────────────────────

const SUGGESTION_CHIPS = ["Pain points", "ROI metrics", "Onboarding", "Competitors"];

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatbotConnectorPage() {
  // Account selector state
  const [selectedAccount, setSelectedAccount] = useState<ChatAccount | null>(null);
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountOptions, setAccountOptions] = useState<ChatAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Account search effect ────────────────────────────────────────────────

  useEffect(() => {
    if (!accountDropdownOpen) return;

    const timer = setTimeout(() => {
      setAccountsLoading(true);
      getChatAccounts(accountSearch)
        .then((res) => setAccountOptions(res.accounts))
        .catch(() => setAccountOptions([]))
        .finally(() => setAccountsLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [accountSearch, accountDropdownOpen]);

  // ─── Click outside to close dropdown ──────────────────────────────────────

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setAccountDropdownOpen(false);
      }
    }

    if (accountDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [accountDropdownOpen]);

  // ─── Auto-scroll to bottom on new messages ────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ─── Auto-expand textarea ─────────────────────────────────────────────────

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  // ─── Select account ───────────────────────────────────────────────────────

  const handleSelectAccount = useCallback((account: ChatAccount) => {
    setSelectedAccount(account);
    setAccountDropdownOpen(false);
    setAccountSearch("");
    // Reset conversation on account switch
    setMessages([]);
    setInput("");
  }, []);

  // ─── Send message ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !selectedAccount || loading) return;

      const userMessage: ChatMessage = {
        id: nextMessageId(),
        role: "user",
        content: text.trim(),
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput("");
      setLoading(true);

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      try {
        const history = updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await sendChatMessage({
          account_id: selectedAccount.id,
          query: text.trim(),
          history: history.slice(0, -1), // exclude the current message from history
        });

        const assistantMessage: ChatMessage = {
          id: nextMessageId(),
          role: "assistant",
          content: response.answer,
          sources: response.sources,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        const errorMessage: ChatMessage = {
          id: nextMessageId(),
          role: "assistant",
          content: `Sorry, something went wrong: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setLoading(false);
      }
    },
    [selectedAccount, loading, messages]
  );

  // ─── Handle keyboard ─────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage]
  );

  // ─── Handle chip click ───────────────────────────────────────────────────

  const handleChipClick = useCallback(
    (chip: string) => {
      sendMessage(chip);
    },
    [sendMessage]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="chat__container">
      {/* Header */}
      <header className="chat__header">
        <div className="chat__header-left">
          <div className="chat__logo">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect width="32" height="32" rx="8" fill="#4f46e5" />
              <path
                d="M8 12a4 4 0 014-4h8a4 4 0 014 4v4a4 4 0 01-4 4h-2l-4 4v-4h-2a4 4 0 01-4-4v-4z"
                fill="white"
              />
            </svg>
          </div>
          <div className="chat__header-text">
            <h1 className="chat__title">Chatbot Connector</h1>
            <p className="chat__subtitle">
              Ask questions about your account data using AI-powered search
            </p>
          </div>
        </div>

        {/* Account Selector */}
        <div className="chat__account-selector" ref={dropdownRef}>
          <button
            type="button"
            className="chat__account-trigger"
            onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M2 3h12M2 8h12M2 13h12" />
            </svg>
            <span>
              {selectedAccount ? selectedAccount.name : "Select Account"}
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`chat__account-chevron ${
                accountDropdownOpen ? "chat__account-chevron--open" : ""
              }`}
              aria-hidden="true"
            >
              <path d="M3 4.5l3 3 3-3" />
            </svg>
          </button>

          {accountDropdownOpen && (
            <div className="chat__account-dropdown">
              <div className="chat__account-search-wrapper">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="#9ca3af"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <circle cx="6" cy="6" r="4.5" />
                  <path d="M9.5 9.5L13 13" />
                </svg>
                <input
                  type="text"
                  className="chat__account-search"
                  placeholder="Search accounts..."
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  autoFocus
                  aria-label="Search accounts"
                />
              </div>
              <div className="chat__account-list">
                {accountsLoading && (
                  <div className="chat__account-loading" role="status" aria-live="polite">Searching...</div>
                )}
                {!accountsLoading && accountOptions.length === 0 && (
                  <div className="chat__account-empty">No accounts found</div>
                )}
                {!accountsLoading &&
                  accountOptions.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={`chat__account-option ${
                        selectedAccount?.id === account.id
                          ? "chat__account-option--selected"
                          : ""
                      }`}
                      onClick={() => handleSelectAccount(account)}
                    >
                      <span className="chat__account-option-name">
                        {account.name}
                      </span>
                      {account.domain && (
                        <span className="chat__account-option-domain">
                          {account.domain}
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Chat Thread */}
      <div className="chat__thread">
        {messages.length === 0 && !loading ? (
          <div className="chat__empty">
            <div className="chat__empty-icon">
              <svg
                width="64"
                height="64"
                viewBox="0 0 64 64"
                fill="none"
                stroke="#d1d5db"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <rect x="8" y="12" width="48" height="36" rx="6" />
                <path d="M20 28h24M20 36h16" />
                <path d="M24 48l-6 8v-8" />
              </svg>
            </div>
            <h3 className="chat__empty-title">
              {selectedAccount
                ? `Ask anything about ${selectedAccount.name}`
                : "Select an account to get started"}
            </h3>
            <p className="chat__empty-subtitle">
              {selectedAccount
                ? "Start a conversation or pick a suggestion below"
                : "Choose an account from the dropdown above to begin chatting"}
            </p>

            {selectedAccount && (
              <div className="chat__suggestions">
                {SUGGESTION_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="chat__suggestion-chip"
                    onClick={() => handleChipClick(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="chat__messages">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chat__message chat__message--${msg.role}`}
              >
                <div className={`chat__bubble chat__bubble--${msg.role}`}>
                  <div className="chat__bubble-content">{msg.content}</div>
                  {msg.sources && msg.sources.length > 0 && (
                    <SourceCitations sources={msg.sources} />
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="chat__message chat__message--assistant" role="status" aria-live="polite">
                <div className="chat__bubble chat__bubble--assistant">
                  <div className="chat__typing">
                    <span className="chat__typing-dot" aria-hidden="true" />
                    <span className="chat__typing-dot" aria-hidden="true" />
                    <span className="chat__typing-dot" aria-hidden="true" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="chat__input-area">
        <div className="chat__input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat__input"
            placeholder={
              selectedAccount
                ? "Type a message..."
                : "Select an account first..."
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={!selectedAccount || loading}
            rows={1}
            aria-label="Chat message"
          />
          <button
            type="button"
            className="chat__send-btn"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || !selectedAccount || loading}
            aria-label="Send message"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 2L9 11" />
              <path d="M18 2l-6 16-3-7-7-3 16-6z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Source Citations Sub-component ─────────────────────────────────────────

function SourceCitations({ sources }: { sources: ChatSource[] }) {
  return (
    <div className="chat__sources">
      <div className="chat__sources-label">Sources</div>
      {sources.map((source, index) => (
        <SourceCard key={`${source.call_id}-${index}`} source={source} index={index} />
      ))}
    </div>
  );
}

function SourceCard({ source, index }: { source: ChatSource; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const { label, className } = relevanceLevel(source.relevance_score);
  const relevancePercent = Math.round(source.relevance_score * 100);

  return (
    <div className="chat__source-card">
      <button
        type="button"
        className="chat__source-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="chat__source-badge">S{index + 1}</span>
        <div className="chat__source-info">
          <span className="chat__source-title">{source.call_title}</span>
          <span className="chat__source-date">{formatDate(source.call_date)}</span>
        </div>
        <span className={`chat__relevance ${className}`}>
          {relevancePercent}% {label}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`chat__source-chevron ${
            expanded ? "chat__source-chevron--open" : ""
          }`}
          aria-hidden="true"
        >
          <path d="M4 5.5l3 3 3-3" />
        </svg>
      </button>

      {expanded && (
        <div className="chat__source-body">
          {source.speaker && (
            <div className="chat__source-speaker">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <circle cx="7" cy="5" r="3" />
                <path d="M2 13c0-2.8 2.2-5 5-5s5 2.2 5 5" />
              </svg>
              <span>{source.speaker}</span>
            </div>
          )}
          <p className="chat__source-text">{source.text}</p>
        </div>
      )}
    </div>
  );
}
