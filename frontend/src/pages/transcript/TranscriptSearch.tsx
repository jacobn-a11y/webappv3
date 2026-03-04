/**
 * TranscriptSearch — Search input with match count display and
 * prev/next navigation buttons.
 */

import { useCallback, useEffect, useRef } from "react";

// ─── TranscriptSearch Component ──────────────────────────────────────────────

export interface TranscriptSearchProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  debouncedQuery: string;
  onClearSearch: () => void;
  activeMatchIndex: number;
  totalMatches: number;
  onPrevMatch: () => void;
  onNextMatch: () => void;
}

export function TranscriptSearch({
  searchQuery,
  onSearchQueryChange,
  debouncedQuery,
  onClearSearch,
  activeMatchIndex,
  totalMatches,
  onPrevMatch,
  onNextMatch,
}: TranscriptSearchProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ─── Keyboard Shortcut: Ctrl/Cmd+F focuses search ───────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ─── Enter / Escape within input ────────────────────────────────────

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (totalMatches > 0) {
          if (e.shiftKey) {
            onPrevMatch();
          } else {
            onNextMatch();
          }
        }
      }
      if (e.key === "Escape") {
        onClearSearch();
        searchInputRef.current?.blur();
      }
    },
    [totalMatches, onPrevMatch, onNextMatch, onClearSearch],
  );

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <>
      <div className="transcript__search" role="search">
        <svg
          className="transcript__search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchInputRef}
          className="transcript__search-input"
          type="text"
          placeholder="Search transcript..."
          autoComplete="off"
          spellCheck={false}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          aria-label="Search transcript"
        />
        <span className="transcript__search-count">
          {debouncedQuery.length >= 2
            ? totalMatches > 0
              ? `${activeMatchIndex + 1}/${totalMatches}`
              : "0 results"
            : ""}
        </span>
      </div>

      {totalMatches > 0 && (
        <div className="transcript__search-nav">
          <button
            className="transcript__search-nav-btn"
            onClick={onPrevMatch}
            aria-label="Previous match"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="18,15 12,9 6,15" />
            </svg>
          </button>
          <button
            className="transcript__search-nav-btn"
            onClick={onNextMatch}
            aria-label="Next match"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
