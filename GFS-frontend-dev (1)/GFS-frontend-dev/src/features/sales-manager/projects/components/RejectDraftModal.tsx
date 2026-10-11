import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { apiClient } from "@/shared/api/client";

type Props = { open: boolean; onClose: () => void; onConfirm: (reason: string, projectId?: string) => void; isSubmitting: boolean };
type ExistingProject = { projectId: string; referenceNumber: string; projectName: string; customerName: string };

const RejectDraftModal = ({ open, onClose, onConfirm, isSubmitting }: Props) => {
  const [reason, setReason] = useState<"irrelevant" | "existing">("irrelevant");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projects, setProjects] = useState<ExistingProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  useEffect(() => {
    if (reason !== "existing" || !open || projects.length > 0) return;
    const loadProjects = async () => {
      setProjectsLoading(true);
      try {
        const response = await apiClient.get("/project-workspace/ai-context");
        if (response.data?.success) setProjects(response.data.data ?? []);
      } catch (error) { console.error("Failed to load existing projects:", error); }
      finally { setProjectsLoading(false); }
    };
    void loadProjects();
  }, [open, projects.length, reason]);

  useEffect(() => { if (!open) { setReason("irrelevant"); setSelectedProjectId(""); setProjectSearch(""); } }, [open]);

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => [project.projectName, project.referenceNumber, project.customerName].filter(Boolean).some((value) => value.toLowerCase().includes(query)));
  }, [projectSearch, projects]);

  if (!open) return null;
  const handleConfirm = () => { if (reason === "existing" && !selectedProjectId) return; onConfirm(reason, reason === "existing" ? selectedProjectId : undefined); };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
    <div role="dialog" aria-modal="true" aria-labelledby="reject-draft-title" className="relative w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
      <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"><X size={18} /></button>
      <h3 id="reject-draft-title" className="pr-9 text-lg font-semibold text-gray-900">Reject Draft</h3>
      <p className="mt-2 text-sm leading-6 text-gray-600">Please specify why you are rejecting this draft.</p>
      <div className="mt-6 space-y-4">
        <label className="flex cursor-pointer items-start gap-3"><input type="radio" name="rejectReason" checked={reason === "irrelevant"} onChange={() => { setReason("irrelevant"); setSelectedProjectId(""); }} className="mt-1 h-4 w-4 accent-red-500" /><span><span className="block text-sm font-medium text-gray-800">Irrelevant / Spam</span><span className="block text-xs text-gray-500">This email is not related to a project.</span></span></label>
        <div className="flex items-start gap-3"><input type="radio" name="rejectReason" aria-label="Part of existing project" checked={reason === "existing"} onChange={() => setReason("existing")} className="mt-1 h-4 w-4 accent-red-500" /><div className="w-full"><p className="text-sm font-medium text-gray-800">Part of existing project</p><p className="text-xs text-gray-500">This email belongs to an already active project.</p>
          {reason === "existing" && <div className="mt-3 overflow-hidden rounded-md border border-gray-200 bg-white">{projectsLoading ? <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading active projects...</div> : <><div className="relative border-b border-gray-200"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="search" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Search projects..." aria-label="Search active projects" className="w-full py-2 pl-9 pr-3 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:bg-gray-50" /></div><div role="listbox" aria-label="Active projects" className="max-h-48 overflow-y-auto">{filteredProjects.length === 0 ? <p className="px-3 py-4 text-center text-xs text-gray-500">No matching projects found.</p> : filteredProjects.map((project) => { const selected = selectedProjectId === project.projectId; return <button key={project.projectId} type="button" role="option" aria-selected={selected} onClick={() => setSelectedProjectId(project.projectId)} className={`flex w-full items-start justify-between gap-3 border-b border-gray-100 px-3 py-2.5 text-left last:border-b-0 ${selected ? "bg-red-50 text-red-700" : "text-gray-700 hover:bg-gray-50"}`}><span className="min-w-0"><span className="block truncate text-sm font-medium">{project.projectName || "Untitled project"}</span><span className="mt-0.5 block truncate text-xs text-gray-500">{project.referenceNumber}{project.customerName ? ` · ${project.customerName}` : ""}</span></span>{selected && <Check size={15} className="mt-0.5 shrink-0" />}</button>; })}</div></>}</div>}
        </div></div>
      </div>
      <div className="mt-8 flex justify-end gap-3 border-t border-gray-200 pt-4"><button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 disabled:opacity-50">Cancel</button><button type="button" onClick={handleConfirm} disabled={isSubmitting || (reason === "existing" && !selectedProjectId)} className={`inline-flex items-center gap-2 rounded-md px-5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${reason === "existing" ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"}`}>{isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null} {reason === "existing" ? "Link to Project" : "Reject Draft"}</button></div>
    </div>
  </div>;
};

export default RejectDraftModal;
