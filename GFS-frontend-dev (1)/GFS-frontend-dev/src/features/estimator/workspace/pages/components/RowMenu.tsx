// pages/estimator/workspace/components/RowMenu.tsx
// Small "..." action menu used by Outlook / Teams / Call Records rows.

import { useEffect, useRef, useState } from "react";
import { MoreVertical, Sparkles, Trash2 } from "lucide-react";

type Action = "ai" | "remove";

type Props = {
  onSelect?: (action: Action) => void;
};

const RowMenu = ({ onSelect }: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Row actions"
        onClick={(e: any) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition"
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-36 bg-white rounded-md border border-gray-200 shadow-lg py-1 text-sm">
          <button
            type="button"
            onClick={() => {
              onSelect?.("ai");
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-gray-700 hover:bg-gray-50"
          >
            <Sparkles size={14} className="text-gray-700" />
            AI Analysis
          </button>
          <button
            type="button"
            onClick={() => {
              onSelect?.("remove");
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-red-500 hover:bg-red-50"
          >
            <Trash2 size={14} />
            Remove
          </button>
        </div>
      )}
    </div>
  );
};

export default RowMenu;
