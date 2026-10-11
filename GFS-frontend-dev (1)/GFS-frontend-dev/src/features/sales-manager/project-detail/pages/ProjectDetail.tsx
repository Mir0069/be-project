// pages/sales-manager/ProjectDetail.tsx

import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  FileText,
  Folder,
  Info,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  PhoneCall,
  Star,
  User,
  Users,
} from "lucide-react";
import zohoLogo from "@assets/zoho_logo.png";
import outlookLogo from "@assets/outlook_logo.png";
import teamsLogo from "@assets/teams_logo.png";
import { useProject } from "@/features/projects/query/projectsQuery";
import { useZohoLead } from "@/features/zoho/query/zohoQuery";
import {
  useProjectCalls,
  useProjectEmails,
  useProjectTeams,
} from "@/features/comms/query/commsQuery";
import StatusBadge from "@/features/sales-manager/projects/components/StatusBadge";
import { SectionCard } from "@/features/sales-manager/create-project/components/form/FormPrimitives";
import { projectTypeOptions } from "@/features/sales-manager/data/mockData";
import type {
  ImportedSource,
  Project,
} from "@/shared/types/project.types";
import type { ZohoLeadStatus } from "@/shared/types/zoho.types";

type TabKey = "overview" | ImportedSource;

const SOURCE_LABEL: Record<ImportedSource, string> = {
  zoho: "Zoho",
  outlook: "Mail",
  teams: "Teams",
  calls: "Calls",
};

const STATUS_CHIP: Record<ZohoLeadStatus, string> = {
  New: "bg-blue-100 text-blue-700",
  Contacted: "bg-yellow-100 text-yellow-800",
  Qualified: "bg-green-100 text-green-700",
  Unqualified: "bg-gray-100 text-gray-600",
};

const projectTypeLabel = (value: string): string =>
  projectTypeOptions.find((o) => o.value === value)?.label ?? value ?? "—";

const DetailRow = ({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) => (
  <div>
    <p className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1.5">
      {icon && <span className="text-gray-400">{icon}</span>}
      {label}
    </p>
    <p className="text-sm text-gray-800">{value || "—"}</p>
  </div>
);

const TabButton = ({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
      active
        ? "border-red-500 text-red-500"
        : "border-transparent text-gray-600 hover:text-gray-800"
    }`}
  >
    {icon}
    {label}
  </button>
);

const ProjectDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useProject(projectId);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  if (isLoading) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">
        Loading project…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">
          Project not found
        </h2>
        <p className="text-sm text-gray-500">
          We couldn't locate this project. It may have been deleted or the
          link is stale.
        </p>
        <button
          type="button"
          onClick={() => navigate("/sales-manager/projects")}
          className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:border-red-500 hover:text-red-500 transition"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  const tabs: TabKey[] = ["overview", ...data.importedSources];

  return (
    <div className="space-y-6 pb-10">
      {/* Back link */}
      <Link
        to="/sales-manager/projects"
        className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-red-500 transition"
      >
        <ArrowLeft size={14} />
        Back to Projects
      </Link>

      {/* Header card */}
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-12 h-12 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
              <Folder size={20} className="text-red-500" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-800 truncate">
                {data.projectName}
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Project: {data.projectCode}
              </p>
              <div className="flex items-center flex-wrap gap-2 mt-2">
                <StatusBadge status={data.status} hasAssignedEstimator={Boolean(data.assignedEstimators?.length)} />
                {data.assignedEstimators?.length ? (
                  <span className="text-xs text-gray-600">
                    Assigned to{" "}
                    <span className="font-medium text-gray-800">
                      {data.assignedEstimators?.map((e: any) => e.name).join(", ")}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 italic">
                    Unassigned
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-500">Created</p>
            <p className="text-sm text-gray-700">{data.createdAt}</p>
            <p className="text-xs text-gray-500 mt-2">Last update</p>
            <p className="text-sm text-gray-700">{data.lastUpdate}</p>
          </div>
        </div>
      </section>

      {/* Tab strip */}
      <div className="border-b border-gray-200 flex items-center flex-wrap gap-1">
        {tabs.map((tab) => (
          <TabButton
            key={tab}
            active={activeTab === tab}
            icon={tabIcon(tab)}
            label={tab === "overview" ? "Overview" : SOURCE_LABEL[tab]}
            onClick={() => setActiveTab(tab)}
          />
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab project={data} />}
      {activeTab === "zoho" && <ZohoTab zohoLeadId={data.zohoLeadId} />}
      {activeTab === "outlook" && <MailTab projectId={data.id} />}
      {activeTab === "teams" && <TeamsTab projectId={data.id} />}
      {activeTab === "calls" && <CallsTab projectId={data.id} />}
    </div>
  );
};

const tabIcon = (tab: TabKey): React.ReactNode => {
  switch (tab) {
    case "overview":
      return <Info size={14} />;
    case "zoho":
      return <img src={zohoLogo} alt="" className="h-3.5 w-auto" />;
    case "outlook":
      return <img src={outlookLogo} alt="" className="h-3.5 w-auto" />;
    case "teams":
      return <img src={teamsLogo} alt="" className="h-3.5 w-auto" />;
    case "calls":
      return <PhoneCall size={14} />;
  }
};

// ============================================================================
// Overview tab — the project's own form data
// ============================================================================

const OverviewTab = ({ project }: { project: Project }) => (
  <div className="space-y-6">
    {/* About Project */}
    <SectionCard title="About Project" icon={<Briefcase size={16} />}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DetailRow
          label="Project Type"
          value={projectTypeLabel(project.projectType)}
        />
        <DetailRow
          label="Due Date"
          icon={<Calendar size={12} />}
          value={project.dueDate}
        />
        <DetailRow
          label="Project Address"
          icon={<MapPin size={12} />}
          value={project.projectAddress}
        />
      </div>
    </SectionCard>

    {/* Client & Contacts */}
    <SectionCard title="Client & Contacts" icon={<Building2 size={16} />}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DetailRow label="Customer Name" value={project.customerName} />
        <DetailRow label="Point of Contact (POC)" value={project.poc} />
        <DetailRow
          label="Contact Phone"
          icon={<Phone size={12} />}
          value={project.contactPhone}
        />
        <DetailRow
          label="Contact Email"
          icon={<Mail size={12} />}
          value={project.contactEmail}
        />
        <DetailRow
          label="Contact Address"
          icon={<MapPin size={12} />}
          value={project.contactAddress}
        />
      </div>
    </SectionCard>

    {/* Stakeholders */}
    <SectionCard title="Stakeholders" icon={<Users size={16} />}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DetailRow label="Architect" value={project.architect} />
        <DetailRow label="Homeowner" value={project.homeowner} />
        <DetailRow label="Drafter / Designer" value={project.drafter} />
      </div>
    </SectionCard>

    {/* Project Notes */}
    <SectionCard title="Project Notes" icon={<FileText size={16} />}>
      {project.projectNotes ? (
        <p className="text-sm text-gray-700 whitespace-pre-line">
          {project.projectNotes}
        </p>
      ) : (
        <p className="text-sm text-gray-400 italic">No notes added.</p>
      )}
    </SectionCard>

    {/* Assigned Estimators */}
    <SectionCard title="Assigned Estimators" icon={<Users size={16} />}>
      {project.assignedEstimators && project.assignedEstimators.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {project.assignedEstimators.map((est) => (
            <li key={est.id} className="py-2 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-800">{est.name}</span>
                <span className="text-xs text-gray-500">{est.email}</span>
              </div>
              {est.status && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${est.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {est.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400 italic">No estimators assigned.</p>
      )}
    </SectionCard>
  </div>
);

// ============================================================================
// Zoho tab — read-only view of the linked Zoho lead
// ============================================================================

const ZohoTab = ({ zohoLeadId }: { zohoLeadId: string | null }) => {
  const { data, isLoading, isError } = useZohoLead(zohoLeadId ?? undefined);

  if (!zohoLeadId) {
    return (
      <SectionCard title="Zoho Lead" icon={<User size={16} />}>
        <p className="text-sm text-gray-400 italic">
          No Zoho lead linked to this project.
        </p>
      </SectionCard>
    );
  }

  if (isLoading) {
    return (
      <div className="py-10 text-center text-sm text-gray-500">
        Loading Zoho lead…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <SectionCard title="Zoho Lead" icon={<User size={16} />}>
        <p className="text-sm text-red-500">
          Couldn't load the linked Zoho lead.
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Identity" icon={<User size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailRow
            label="Name"
            value={`${data.firstName} ${data.lastName}`.trim()}
          />
          <DetailRow label="Company" value={data.company} />
          <DetailRow label="Title" value={data.title} />
          <DetailRow
            label="Lead Status"
            value={
              <span
                className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-medium ${
                  STATUS_CHIP[data.leadStatus]
                }`}
              >
                {data.leadStatus}
              </span>
            }
          />
        </div>
      </SectionCard>

      <SectionCard title="Contact" icon={<Mail size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailRow
            label="Email"
            icon={<Mail size={12} />}
            value={data.email}
          />
          <DetailRow
            label="Phone"
            icon={<Phone size={12} />}
            value={data.phone}
          />
          <DetailRow
            label="Mobile"
            icon={<Phone size={12} />}
            value={data.mobile}
          />
          <DetailRow
            label="Address"
            icon={<MapPin size={12} />}
            value={data.address}
          />
        </div>
      </SectionCard>

      <SectionCard title="Lead Insight" icon={<Star size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailRow label="Source" value={data.leadSource} />
          <DetailRow label="Industry" value={data.industry} />
          <DetailRow label="Rating" value={data.rating || "—"} />
          <DetailRow
            label="Project Interest"
            value={data.projectInterest}
          />
          <DetailRow
            label="Estimated Budget"
            value={data.estimatedBudget}
          />
        </div>
      </SectionCard>

      <SectionCard title="Description" icon={<FileText size={16} />}>
        {data.description ? (
          <p className="text-sm text-gray-700 whitespace-pre-line">
            {data.description}
          </p>
        ) : (
          <p className="text-sm text-gray-400 italic">No description.</p>
        )}
      </SectionCard>

      <div>
        <Link
          to={`/sales-manager/create-project/zoho-lead/${zohoLeadId}`}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:border-red-500 hover:text-red-500 transition"
        >
          Open full lead in Zoho importer
        </Link>
      </div>
    </div>
  );
};

// ============================================================================
// Mail tab — emails linked to the project
// ============================================================================

const MailTab = ({ projectId }: { projectId: string }) => {
  const { data, isLoading, isError } = useProjectEmails(projectId);

  if (isLoading) {
    return (
      <div className="py-10 text-center text-sm text-gray-500">
        Loading emails…
      </div>
    );
  }

  if (isError) {
    return (
      <SectionCard title="Mail" icon={<Mail size={16} />}>
        <p className="text-sm text-red-500">Couldn't load emails.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Mail" icon={<Mail size={16} />}>
      {!data || data.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No emails on record for this project.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.map((email) => (
            <li key={email.id} className="py-3">
              <div className="flex items-start gap-3">
                <Mail size={16} className="text-gray-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {email.subject}
                    </p>
                    <p className="text-xs text-gray-500 shrink-0">
                      {email.date}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {email.from} → {email.to}
                  </p>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {email.preview}
                  </p>
                  <span
                    className={`inline-block text-xs px-2 py-0.5 rounded-md mt-1.5 ${
                      email.direction === "inbound"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {email.direction === "inbound" ? "Inbound" : "Outbound"}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
};

// ============================================================================
// Teams tab — Teams threads linked to the project
// ============================================================================

const TeamsTab = ({ projectId }: { projectId: string }) => {
  const { data, isLoading, isError } = useProjectTeams(projectId);

  if (isLoading) {
    return (
      <div className="py-10 text-center text-sm text-gray-500">
        Loading Teams threads…
      </div>
    );
  }

  if (isError) {
    return (
      <SectionCard title="Teams" icon={<MessageSquare size={16} />}>
        <p className="text-sm text-red-500">Couldn't load Teams threads.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Teams" icon={<MessageSquare size={16} />}>
      {!data || data.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No Teams threads on record for this project.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.map((thread) => (
            <li
              key={thread.id}
              className="border border-gray-200 rounded-md p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {thread.title}
                  </p>
                  <p className="text-sm text-gray-700 mt-1 line-clamp-1">
                    {thread.lastMessage}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {thread.lastMessageBy} · {thread.lastMessageDate}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                    {thread.messageCount} msgs
                  </span>
                  <p className="text-xs text-gray-500 mt-1">
                    {thread.participants.length} people
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
};

// ============================================================================
// Calls tab — call records linked to the project
// ============================================================================

const CallsTab = ({ projectId }: { projectId: string }) => {
  const { data, isLoading, isError } = useProjectCalls(projectId);

  if (isLoading) {
    return (
      <div className="py-10 text-center text-sm text-gray-500">
        Loading call records…
      </div>
    );
  }

  if (isError) {
    return (
      <SectionCard title="Calls" icon={<PhoneCall size={16} />}>
        <p className="text-sm text-red-500">Couldn't load call records.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Calls" icon={<PhoneCall size={16} />}>
      {!data || data.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No call records on record for this project.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.map((call) => (
            <li
              key={call.id}
              className="border border-gray-200 rounded-md p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {call.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    {call.participants.join(", ")}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{call.date}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                    {call.durationMinutes} min
                  </span>
                  {call.hasTranscript && (
                    <p className="text-xs text-green-700 mt-1">
                      Transcript ready
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
};

export default ProjectDetail;
