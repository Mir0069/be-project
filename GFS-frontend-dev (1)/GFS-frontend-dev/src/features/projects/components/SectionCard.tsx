import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export const SectionCard = ({
  title,
  icon,
  action,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** When true, the header toggles the body open/closed via a chevron. */
  collapsible?: boolean;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);

  const heading = (
    <div className="flex items-center gap-2">
      <div className="text-red-500">{icon}</div>
      <h2 className="text-lg font-semibold text-red-500">{title}</h2>
    </div>
  );

  if (!collapsible) {
    return (
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-5">
          {heading}
          {action}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className={`flex items-center justify-between ${open ? "mb-5" : ""}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open ? "true" : "false"}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {heading}
          <ChevronDown
            size={18}
            className={`text-gray-400 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
          />
        </button>
        {action}
      </div>
      {open && children}
    </section>
  );
};

export const FieldGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-5 text-sm">{children}</div>
);

export const Field = ({ label, value }: { label: string; value?: string | null }) =>
  (
    <div>
      <p className="text-gray-500">{label}</p>
      <p className="font-medium text-gray-800 break-words">{value || "—"}</p>
    </div>
  );
