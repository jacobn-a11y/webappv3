import { useState, useRef, useEffect } from "react";

interface Option {
  value: string;
  label: string;
  group?: string;
}

interface MultiSelectProps {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  grouped?: boolean;
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = "Select...",
  grouped = false,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const removeTag = (value: string) => {
    onChange(selected.filter((v) => v !== value));
  };

  const labelMap = Object.fromEntries(options.map((o) => [o.value, o.label]));

  // Group options if grouped mode
  const groups = grouped
    ? filtered.reduce<Record<string, Option[]>>((acc, opt) => {
        const g = opt.group ?? "Other";
        if (!acc[g]) acc[g] = [];
        acc[g].push(opt);
        return acc;
      }, {})
    : { "": filtered };

  return (
    <div className="multi-select" ref={containerRef}>
      <label className="multi-select__label">{label}</label>

      {selected.length > 0 && (
        <div className="multi-select__tags">
          {selected.map((v) => (
            <span key={v} className="multi-select__tag">
              {labelMap[v] ?? v}
              <button
                type="button"
                className="multi-select__tag-remove"
                onClick={() => removeTag(v)}
                aria-label={`Remove ${labelMap[v] ?? v}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        className={`multi-select__trigger ${open ? "multi-select__trigger--open" : ""}`}
        onClick={() => setOpen(!open)}
        role="combobox"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        <span className="multi-select__placeholder">
          {selected.length === 0
            ? placeholder
            : `${selected.length} selected`}
        </span>
        <svg
          className="multi-select__chevron"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>

      {open && (
        <div className="multi-select__dropdown">
          <input
            type="text"
            className="multi-select__search"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            aria-label={`Search ${label} options`}
          />
          <div className="multi-select__options">
            {Object.entries(groups).map(([groupName, groupOptions]) => (
              <div key={groupName}>
                {grouped && groupName && (
                  <div className="multi-select__group-label">{groupName}</div>
                )}
                {groupOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className={`multi-select__option ${selected.includes(opt.value) ? "multi-select__option--selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(opt.value)}
                      onChange={() => toggle(opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="multi-select__empty">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
