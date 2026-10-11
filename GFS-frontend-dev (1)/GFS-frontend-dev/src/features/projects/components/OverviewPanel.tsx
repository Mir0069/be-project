import { Calendar, FileText, Mail, MapPin, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useProject, useUpdateProjectEstimators } from "@/features/projects/query/projectsQuery";
import { useEstimators } from "@/features/sales-manager/create-project/query/show-estimator.query";

import type { ApiProject } from "@/services/project-workspace";
import { getSourceMeta } from "@/features/notifications/utils";
import { useAuth } from "@/context/AuthContext";
import { useExternalContacts, useUpdateProjectDueDate } from "@/features/projects/query/projectWorkspaceQuery";
import { formatProjectAddress } from "@/features/projects/utils/projectIdentity";
import { normalizeProjectStatus } from "@/shared/lib/statusConfig";
import { hasAnyRole } from "@/shared/lib/roleAccess";
import {
  getPartnerForProject,
  usePartnerDemoStore,
} from "@/features/partners/partnerDemoStore";

import { SectionCard, FieldGrid, Field } from "./SectionCard";
import { RecentProjectActivity } from "@/features/audit-logs/components/RecentProjectActivity";

const formatDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

const toDateInputValue = (iso?: string | null): string => iso?.slice(0, 10) ?? "";

const formatContactDate = (iso?: string | null): string =>
  formatDate(iso) || "-";

const formatSource = (source: string): string =>
  source.toLowerCase() === "cc" ? "Cc" : source.toLowerCase() === "to" ? "To" : "From";

const PROJECT_TYPE_LABELS: Record<string, string> = {
  NEW_ESTIMATE: "New Estimate",
  RE_QUOTE: "Re-Quote",
  VARIATION: "Variation",
};

const formatEnumLabel = (value?: string | null): string | null => {
  if (!value) return null;

  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && ["for", "of", "to"].includes(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
};

export const OverviewPanel = ({ project: apiProject }: { project: ApiProject }) => {
  const { user } = useAuth();
  const source = getSourceMeta(apiProject.creationSource);
  
  const { data: project } = useProject(apiProject.id);
  const externalContactsQuery = useExternalContacts(apiProject.id);
  const { data: estimatorsData } = useEstimators();
  const updateEstimatorMutation = useUpdateProjectEstimators();
  const updateDueDateMutation = useUpdateProjectDueDate();
  const partnerState = usePartnerDemoStore();

  const [selectedEstimatorId, setSelectedEstimatorId] = useState("");
  const [dueDate, setDueDate] = useState(toDateInputValue(apiProject.dueDate));

  const estimators = estimatorsData || [];
  const assignedEstimators = project?.assignedEstimators || [];

  const handleAddEstimator = () => {
    if (!selectedEstimatorId) return;
    if (assignedEstimators.some((e: any) => e.id === selectedEstimatorId)) return;

    const newEstimatorIds = [
      ...assignedEstimators.map((e: any) => e.id),
      selectedEstimatorId
    ];

    updateEstimatorMutation.mutate({
      id: apiProject.id,
      estimatorIds: newEstimatorIds,
    });
    setSelectedEstimatorId("");
  };

  const handleRemoveEstimator = (estimatorId: string) => {
    const newEstimatorIds = assignedEstimators
      .filter((e: any) => e.id !== estimatorId)
      .map((e: any) => e.id);

    updateEstimatorMutation.mutate({
      id: apiProject.id,
      estimatorIds: newEstimatorIds,
    });
  };

  const projectObj = apiProject;
  const canManageDueDate = hasAnyRole(user?.role, ["SALES_MANAGER", "SYSTEM_ADMIN", "SUPER_ADMIN"]);

  useEffect(() => {
    setDueDate(toDateInputValue(apiProject.dueDate));
  }, [apiProject.dueDate]);

  const handleSaveDueDate = () => {
    if (!dueDate) return;
    updateDueDateMutation.mutate({ id: apiProject.id, dueDate });
  };

  const assignedPartner = getPartnerForProject(partnerState, projectObj.id);
  const projectAddress = formatProjectAddress(
    projectObj.jobAddress,
    projectObj.address,
  );


  return (
    <div className="space-y-6">
      <SectionCard
        title="Project Details"
        icon={<FileText size={16} />}
        action={
          source ? (
            <span className={`text-xs px-2 py-0.5 rounded-md ring-1 ${source.className}`}>
              {source.label}
            </span>
          ) : null
        }
      >
        <FieldGrid>
          <Field label="Code Number" value={projectObj.referenceNumber} />
          <Field label="Project Name" value={projectObj.projectName} />
          <Field
            label="Project Type"
            value={PROJECT_TYPE_LABELS[projectObj.projectType] || formatEnumLabel(projectObj.projectType)}
          />
          <Field label="Status" value={normalizeProjectStatus(projectObj.status, projectObj.analysisStatus, assignedEstimators.length > 0)} />
          <Field label="Lead Status" value={projectObj.leadStatus} />
          <Field label="Lead ID" value={projectObj.zohoLeadId} />
          <Field label="Partner" value={assignedPartner?.name} />
          <Field label="Quote Number" value={projectObj.quoteNumber} />
          <Field label="Received" value={formatDate(projectObj.receivedDate)} />
          {canManageDueDate ? (
            <div>
              <label htmlFor="project-due-date" className="text-gray-500">Due Date</label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Calendar size={16} className="text-gray-400" aria-hidden="true" />
                <input
                  id="project-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-medium text-gray-800 focus:border-red-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveDueDate}
                  disabled={!dueDate || updateDueDateMutation.isPending}
                  className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updateDueDateMutation.isPending ? "Saving..." : projectObj.dueDate ? "Update" : "Set date"}
                </button>
              </div>
              {updateDueDateMutation.isError ? (
                <p className="mt-1 text-xs text-red-600">Could not save the due date. Please try again.</p>
              ) : null}
            </div>
          ) : (
            <Field label="Due Date" value={formatDate(projectObj.dueDate)} />
          )}
        </FieldGrid>
        {projectObj.description ? (
          <div className="mt-5 text-sm">
            <p className="text-gray-500">Description</p>
            <p className="font-medium text-gray-800 break-words">{projectObj.description}</p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Client Details" icon={<Users size={16} />}>
        <FieldGrid>
          <Field label="Customer Name" value={projectObj.customerName} />
          <Field label="Company" value={projectObj.company} />
          <Field label="Email" value={projectObj.customerEmail} />
          <Field label="Phone" value={projectObj.customerPhone} />
          <Field label="Website" value={projectObj.customerWebsite} />
        </FieldGrid>
      </SectionCard>

      {projectAddress ? (
        <SectionCard title="Project Address" icon={<MapPin size={16} />}>
          <p className="text-sm font-medium text-gray-800 break-words">
            {projectAddress}
          </p>
        </SectionCard>
      ) : null}

      <SectionCard title="External Contacts" icon={<Mail size={16} />}>
        {externalContactsQuery.isLoading ? (
          <p className="text-sm text-gray-500">Loading external contacts...</p>
        ) : externalContactsQuery.isError ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-gray-500">Could not load external contacts.</p>
            <button
              type="button"
              onClick={() => externalContactsQuery.refetch()}
              className="text-sm font-medium text-red-600 hover:text-red-700"
            >
              Retry
            </button>
          </div>
        ) : externalContactsQuery.data?.contacts.length ? (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="w-full min-w-[620px] text-left text-sm text-gray-600">
              <thead className="border-b border-gray-200 bg-gray-50 text-gray-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {externalContactsQuery.data.contacts.map((contact) => (
                  <tr key={contact.email} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{contact.name || "-"}</td>
                    <td className="px-4 py-3">{contact.email}</td>
                    <td className="px-4 py-3">
                      {contact.sources?.length ? contact.sources.map(formatSource).join(", ") : "-"}
                    </td>
                    <td className="px-4 py-3">{formatContactDate(contact.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No external contacts recorded.</p>
        )}
      </SectionCard>

      {hasAnyRole(user?.role, ['SALES_MANAGER', 'SYSTEM_ADMIN']) && (
        <SectionCard title="Assigned Estimators" icon={<Users size={16} />}>
          <div className="mb-4 flex gap-3">
            <select
              value={selectedEstimatorId}
              onChange={(e: any) => setSelectedEstimatorId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 flex-1 max-w-xs"
            >
              <option value="">Select Estimator</option>
              {estimators
                .filter((e: any) => !assignedEstimators.some((ae: any) => ae.id === e.id))
                .map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          <button
            onClick={handleAddEstimator}
            disabled={!selectedEstimatorId || updateEstimatorMutation.isPending}
            className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateEstimatorMutation.isPending ? "Adding..." : "Add Estimator"}
          </button>
        </div>

        {assignedEstimators.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-gray-200">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-gray-800 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Email</th>
                  <th className="py-3 px-4 font-medium w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assignedEstimators.map((estimator: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-medium text-gray-800">
                      {estimator.name || `${estimator.firstName || ''} ${estimator.lastName || ''}`.trim()}
                    </td>
                    <td className="py-3 px-4">{estimator.email}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleRemoveEstimator(estimator.id)}
                        disabled={updateEstimatorMutation.isPending}
                        className="text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Remove Estimator"
                      >
                        <X size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">No estimators assigned yet.</p>
        )}
      </SectionCard>
      )}
      <RecentProjectActivity project={apiProject} />
    </div>
  );
};

export default OverviewPanel;
