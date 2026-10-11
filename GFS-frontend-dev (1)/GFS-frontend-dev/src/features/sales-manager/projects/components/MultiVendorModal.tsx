import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Lightbulb, Link2, Loader2, Mail, RefreshCw, Search, X } from "lucide-react";

import {
  useLinkableProjects,
  type DraftProject,
  type LinkableProject,
} from "@/features/sales-manager/query/draftsQuery";

type Props = {
  open: boolean;
  draft: DraftProject | null;
  isLinking: boolean;
  onClose: () => void;
  onConfirm: (projectId: string, projectName: string) => void;
};

type SuggestedProject = {
  project: LinkableProject;
  reasons: string[];
};

const normalize = (value: unknown): string => {
  if (typeof value === "string") {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  if (value && typeof value === "object") {
    return Object.values(value)
      .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  return "";
};

const valuesMatch = (left: unknown, right: unknown): boolean => {
  const a = normalize(left);
  const b = normalize(right);
  if (a.length < 4 || b.length < 4) return false;
  return a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
};

const emailDomain = (email?: string | null): string => {
  const domain = email?.split("@")[1]?.toLowerCase().trim() ?? "";
  return ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com"].includes(domain)
    ? ""
    : domain;
};

export const getSuggestedProjects = (
  draft: DraftProject | null,
  projects: LinkableProject[],
): SuggestedProject[] => {
  if (!draft) return [];

  // Suggestions only reduce search effort; the user must still select and
  // confirm the destination project before any backend link is created.
  return projects
    .map((project) => {
      const reasons: string[] = [];
      if (valuesMatch(draft.proposed?.projectName, project.projectName)) {
        reasons.push("Matching project name");
      }
      if (
        valuesMatch(draft.address, project.jobAddress) ||
        valuesMatch(draft.address, project.address)
      ) {
        reasons.push("Matching address");
      }
      if (valuesMatch(draft.proposed?.customerName, project.customerName)) {
        reasons.push("Matching customer");
      }
      const senderDomain = emailDomain(draft.fromAddress);
      if (senderDomain && senderDomain === emailDomain(project.customerEmail)) {
        reasons.push("Matching email domain");
      }
      return { project, reasons };
    })
    .filter((candidate) => candidate.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length)
    .slice(0, 3);
};

const displayAddress = (value: LinkableProject["address"]): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return Object.values(value)
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .join(", ");
};

const projectAddress = (project: LinkableProject): string =>
  project.jobAddress || displayAddress(project.address);

const MultiVendorModal = ({
  open,
  draft,
  isLinking,
  onClose,
  onConfirm,
}: Props) => {
  const [search, setSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const { data: projects = [], isLoading, isError, refetch } = useLinkableProjects(open);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedProjectId("");
  }, [open, draft?.id]);

  const suggestions = useMemo(() => getSuggestedProjects(draft, projects), [draft, projects]);
  const suggestionIds = useMemo(
    () => new Set(suggestions.map(({ project }) => project.projectId)),
    [suggestions],
  );

  const filteredProjects = useMemo(() => {
    const term = normalize(search);
    const matching = !term
      ? projects
      : projects.filter((project) =>
          normalize(
            [
              project.projectName,
              project.referenceNumber,
              project.customerName,
              project.jobAddress,
              projectAddress(project),
            ]
              .filter(Boolean)
              .join(" "),
          ).includes(term),
        );

    return search ? matching : matching.filter((project) => !suggestionIds.has(project.projectId));
  }, [search, projects, suggestionIds]);

  if (!open || !draft) return null;

  const renderProject = (project: LinkableProject, reasons?: string[]) => {
    const selected = selectedProjectId === project.projectId;
    const address = projectAddress(project);
    return (
      <button
        key={project.projectId}
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => setSelectedProjectId(project.projectId)}
        className={`flex w-full items-start gap-3 border-b border-gray-100 px-3 py-3 text-left transition last:border-b-0 ${
          selected ? "bg-red-50" : "hover:bg-gray-50"
        }`}
      >
        <Building2 size={17} className={`mt-0.5 shrink-0 ${selected ? "text-red-600" : "text-gray-400"}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">
            {project.projectName || "Untitled project"}
          </span>
          <span className="mt-0.5 block truncate text-xs text-gray-500">
            {[project.referenceNumber, project.customerName].filter(Boolean).join(" | ")}
          </span>
          {address ? <span className="mt-0.5 block truncate text-xs text-gray-500">{address}</span> : null}
          {reasons?.length ? (
            <span className="mt-1 block text-xs font-medium text-green-700">{reasons.join(" | ")}</span>
          ) : null}
        </span>
        {selected ? <Check size={16} className="mt-0.5 shrink-0 text-red-600" /> : null}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="multi-vendor-title"
        className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
        >
          <X size={18} />
        </button>

        <div className="pr-9">
          <h3 id="multi-vendor-title" className="text-lg font-semibold text-gray-900">
            Add Vendor to Existing Project
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Link this vendor email and its attachments without creating a duplicate project.
          </p>
        </div>

        <div className="mt-5 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase text-gray-500">Incoming vendor</p>
          <p className="mt-1 text-sm font-medium text-gray-900">{draft.fromName || "Unknown sender"}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
            <Mail size={12} /> {draft.fromAddress || "No sender email available"}
          </p>
        </div>

        <div className="relative mt-5">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search project, address, customer or reference"
            aria-label="Search existing projects"
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-800 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
          />
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin text-red-500" /> Loading active projects...
            </div>
          ) : isError ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-600">Could not load active projects.</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700"
              >
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : (
            <>
              {!search && suggestions.length > 0 ? (
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-500">
                    <Lightbulb size={14} /> Suggested matches
                  </h4>
                  <div role="listbox" aria-label="Suggested projects" className="overflow-hidden rounded-md border border-green-200">
                    {suggestions.map(({ project, reasons }) => renderProject(project, reasons))}
                  </div>
                </section>
              ) : null}

              <section className={suggestions.length > 0 && !search ? "mt-5" : ""}>
                <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                  {search ? "Search results" : "Active projects"}
                </h4>
                <div role="listbox" aria-label="Active projects" className="overflow-hidden rounded-md border border-gray-200">
                  {filteredProjects.length > 0 ? (
                    filteredProjects.map((project) => renderProject(project))
                  ) : (
                    <p className="px-4 py-10 text-center text-sm text-gray-500">
                      {search ? "No projects match your search." : "No other active projects are available."}
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isLinking}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const selected = projects.find((project) => project.projectId === selectedProjectId);
              if (selected) onConfirm(selected.projectId, selected.projectName || "the selected project");
            }}
            disabled={!selectedProjectId || isLinking}
            className="inline-flex min-w-36 items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLinking ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
            {isLinking ? "Linking..." : "Link to Project"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MultiVendorModal;
