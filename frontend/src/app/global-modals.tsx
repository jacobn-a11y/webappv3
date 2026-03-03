import { Link } from "react-router-dom";
import type { ChatAccount, StoryLibraryItem } from "../lib/api";

interface StoryPickerModalProps {
  open: boolean;
  dialogRef: React.Ref<HTMLDivElement>;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  error: string | null;
  accounts: ChatAccount[];
  onClose: () => void;
  onSelectAccount: (accountId: string) => void;
}

export function StoryPickerModal({
  open,
  dialogRef,
  search,
  onSearchChange,
  loading,
  error,
  accounts,
  onClose,
  onSelectAccount,
}: StoryPickerModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal story-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Pick account for story creation"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <h2 className="modal__title">New Story</h2>
            <p className="modal__subtitle">Select an account to start generating</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 5l10 10M15 5l-10 10" />
            </svg>
          </button>
        </div>
        <div className="modal__body story-picker__body">
          <input
            type="search"
            className="form-field__input"
            placeholder="Search accounts"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search accounts for story generation"
          />

          {loading && (
            <div className="state-view" role="status" aria-live="polite">
              <div className="spinner" />
              <div className="state-view__title">Loading accounts...</div>
            </div>
          )}

          {!loading && error && (
            <div className="state-view state-view--error" role="alert">
              <div className="state-view__title">Unable to load accounts</div>
              <div className="state-view__message">{error}</div>
            </div>
          )}

          {!loading && !error && (
            <div className="story-picker__list">
              {accounts.map((account) => (
                <button
                  type="button"
                  key={account.id}
                  className="story-picker__item"
                  onClick={() => onSelectAccount(account.id)}
                >
                  <span className="story-picker__item-title">{account.name}</span>
                  <span className="story-picker__item-meta">
                    {account.domain ?? "No domain"} · {account.call_count} calls
                  </span>
                </button>
              ))}
              {accounts.length === 0 && (
                <div className="story-picker__empty">No accounts match your search.</div>
              )}
            </div>
          )}

          <div className="story-picker__footer">
            <Link className="btn btn--ghost" to="/accounts" onClick={onClose}>
              Browse full account list
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface CommandPaletteQuickNavItem {
  to: string;
  label: string;
}

interface CommandPaletteModalProps {
  open: boolean;
  dialogRef: React.Ref<HTMLDivElement>;
  inputRef: React.Ref<HTMLInputElement>;
  query: string;
  onQueryChange: (value: string) => void;
  quickNavMatches: CommandPaletteQuickNavItem[];
  accounts: ChatAccount[];
  stories: StoryLibraryItem[];
  loading: boolean;
  onClose: () => void;
  onNavigate: (to: string) => void;
}

export function CommandPaletteModal({
  open,
  dialogRef,
  inputRef,
  query,
  onQueryChange,
  quickNavMatches,
  accounts,
  stories,
  loading,
  onClose,
  onNavigate,
}: CommandPaletteModalProps) {
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="modal command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-palette__header">
          <input
            ref={inputRef}
            type="search"
            className="form-field__input"
            placeholder="Search pages, accounts, and stories"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label="Global search"
          />
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="command-palette__results" role="listbox" aria-label="Search results">
          {quickNavMatches.map((item) => (
            <button
              type="button"
              key={`nav:${item.to}`}
              className="command-palette__item"
              role="option"
              onClick={() => onNavigate(item.to)}
            >
              <span className="command-palette__item-label">{item.label}</span>
              <span className="command-palette__item-meta">Page</span>
            </button>
          ))}
          {accounts.map((account) => (
            <button
              type="button"
              key={`acct:${account.id}`}
              className="command-palette__item"
              role="option"
              onClick={() => onNavigate(`/accounts/${account.id}`)}
            >
              <span className="command-palette__item-label">{account.name}</span>
              <span className="command-palette__item-meta">
                Account {account.domain ? `· ${account.domain}` : ""}
              </span>
            </button>
          ))}
          {stories.map((story) => (
            <button
              type="button"
              key={`story:${story.id}`}
              className="command-palette__item"
              role="option"
              onClick={() => onNavigate("/stories")}
            >
              <span className="command-palette__item-label">{story.title}</span>
              <span className="command-palette__item-meta">
                Story · {story.account.name}
              </span>
            </button>
          ))}
          {loading && (
            <div className="command-palette__empty" role="status" aria-live="polite">
              Searching...
            </div>
          )}
          {!loading &&
            quickNavMatches.length === 0 &&
            accounts.length === 0 &&
            stories.length === 0 && (
              <div className="command-palette__empty">
                Type at least 2 characters to search.
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
