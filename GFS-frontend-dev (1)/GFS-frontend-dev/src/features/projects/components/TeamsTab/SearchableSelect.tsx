import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type SelectOption = { id: string; label: string };

type Props = {
  label: string;
  value: string;
  options: SelectOption[];
  placeholder: string;
  loadingText?: string;
  isLoading?: boolean;
  disabled?: boolean;
  disabledPlaceholder?: string;
  onChange: (id: string) => void;
};

export const SearchableSelect = ({
  label,
  value,
  options,
  placeholder,
  loadingText = "Loading…",
  isLoading = false,
  disabled = false,
  disabledPlaceholder,
  onChange,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Enter transition + focus the search box on open.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setShown(true));
    searchRef.current?.focus();
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setShown(false);
    setOpen(false);
    setQuery("");
    setActive(0);
  };

  const openMenu = () => {
    if (disabled) return;
    setActive(Math.max(0, filtered.findIndex((o) => o.id === value)));
    setOpen(true);
  };

  const pick = (id: string) => {
    onChange(id);
    close();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) pick(opt.id);
    }
  };

  const triggerText = disabled
    ? disabledPlaceholder ?? placeholder
    : selected?.label ?? (isLoading ? loadingText : placeholder);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
          disabled
            ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
            : open
              ? "border-red-400 bg-white text-gray-800 ring-2 ring-red-100"
              : "border-gray-300 bg-white text-gray-800 hover:border-gray-400"
        }`}
      >
        <span className={`truncate ${selected ? "" : "text-gray-400"}`}>{triggerText}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`absolute z-10 mt-1.5 w-full origin-top overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg transition-all duration-150 ${
            shown ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Search size={14} className="shrink-0 text-gray-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onListKey}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full bg-transparent text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
            />
          </div>

          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {isLoading ? (
              <li className="px-3 py-2 text-sm text-gray-400">{loadingText}</li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
            ) : (
              filtered.map((o, i) => {
                const isSelected = o.id === value;
                return (
                  <li key={o.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => pick(o.id)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        i === active ? "bg-red-50 text-gray-900" : "text-gray-700"
                      }`}
                    >
                      <span className="truncate">{o.label}</span>
                      {isSelected && <Check size={15} className="shrink-0 text-red-500" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default SearchableSelect;
