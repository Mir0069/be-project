// pages/sales-manager/ZohoLeadDetail.tsx

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Briefcase,
  Building2,
  ChevronDown,
  DollarSign,
  FileText,
  Globe,
  Inbox,
  Mail,
  MapPin,
  Phone,
  Printer,
  Star,
  StickyNote,
  User,
  Users,
} from "lucide-react";
import zohoLogo from "@assets/zoho_logo.png";
import { useZohoLead } from "@/features/zoho/query/zohoQuery";
import { showToast } from "@/components/ui/toast";
import { projectTypeOptions } from "../../data/mockData";
import {
  Field,
  SectionCard,
  inputCls,
} from "@/features/sales-manager/create-project/components/form/FormPrimitives";
import type {
  ZohoLead,
  ZohoLeadRating,
  ZohoLeadStatus,
} from "@/shared/types/zoho.types";

const STATUS_CHIP: Record<ZohoLeadStatus, string> = {
  New: "bg-blue-100 text-blue-700",
  Contacted: "bg-yellow-100 text-yellow-800",
  Qualified: "bg-green-100 text-green-700",
  Unqualified: "bg-gray-100 text-gray-600",
};

const RATING_OPTIONS: ZohoLeadRating[] = [
  "",
  "Hot",
  "Warm",
  "Cold",
  "Acquired",
];

const PROJECT_INTEREST_OPTIONS = [
  "",
  "Glass Bridge",
  "Glass Stairs",
  "Glass Flooring",
  "Custom",
];

const slugifyInterest = (interest: string): string => {
  const match = projectTypeOptions.find(
    (o) =>
      o.label.toLowerCase() === interest.toLowerCase() ||
      o.value === interest.toLowerCase().replace(/\s+/g, "-")
  );
  return match?.value ?? "";
};

const getInitials = (first: string, last: string) =>
  `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();

type IconInputProps = {
  icon: React.ReactNode;
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

const IconInput = ({ icon, label, ...rest }: IconInputProps) => (
  <div className="relative">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
      {icon}
    </span>
    <input
      aria-label={label}
      className={`${inputCls} pl-9`}
      {...rest}
    />
  </div>
);

const ZohoLeadDetail = () => {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useZohoLead(leadId);

  const [draft, setDraft] = useState<ZohoLead | null>(null);
  const [newNote, setNewNote] = useState("");

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const updateField = <K extends keyof ZohoLead>(
    key: K,
    value: ZohoLead[K]
  ) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleAddNote = () => {
    const content = newNote.trim();
    if (!content || !draft) return;
    const note = {
      id: `n-local-${Date.now()}`,
      author: "Sales Manager",
      content,
      createdDate: new Date().toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    setDraft({ ...draft, notes: [note, ...draft.notes] });
    setNewNote("");
  };

  if (isLoading) {
    return (
      <div className="py-20 text-center text-sm text-gray-500">
        Loading lead from Zoho…
      </div>
    );
  }

  if (isError || (!isLoading && !data)) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">
          Lead not found
        </h2>
        <p className="text-sm text-gray-500">
          We couldn't locate this lead in Zoho. It may have been deleted or
          the link is stale.
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:border-red-500 hover:text-red-500 transition"
        >
          Back
        </button>
      </div>
    );
  }

  if (!draft) return null;

  const handleSave = () => {
    const prefill = {
      projectName: "",
      projectType: slugifyInterest(draft.projectInterest),
      dueDate: "",
      projectAddress: draft.address,
      customerName: draft.company,
      poc: `${draft.firstName} ${draft.lastName}`.trim(),
      contactPhone: draft.phone,
      contactEmail: draft.email,
      contactAddress: draft.address,
      architect: "",
      homeowner: "",
      drafter: "",
      projectNotes: draft.description,
    };

    showToast("success", "Lead data imported");
    navigate("/sales-manager/create-project", {
      state: { prefill, zohoLeadId: draft.id },
    });
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Lead header card */}
      <section className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-base font-semibold text-gray-600">
              {getInitials(draft.firstName, draft.lastName) || (
                <User size={20} />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-800 truncate">
                {draft.firstName} {draft.lastName}
                <span className="text-gray-400 font-normal">
                  {" — "}
                </span>
                <span className="text-gray-700">{draft.company}</span>
              </h1>
              <div className="flex items-center flex-wrap gap-2 mt-2">
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-medium ${
                    STATUS_CHIP[draft.leadStatus]
                  }`}
                >
                  {draft.leadStatus}
                </span>
                {draft.rating && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-orange-50 text-orange-700">
                    <Star size={11} fill="currentColor" /> {draft.rating}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  Source: {draft.leadSource || "—"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <img src={zohoLogo} alt="Zoho" className="h-7 w-auto" />
            <span className="text-xs text-gray-500 hidden sm:inline">
              Imported from Zoho
            </span>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-4">
          Review and edit the imported data, then save to continue creating
          the project.
        </p>
      </section>

      {/* Lead Information */}
      <SectionCard title="Lead Information" icon={<User size={16} />}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="First Name">
              <input
                aria-label="First Name"
                className={inputCls}
                value={draft.firstName}
                onChange={(e: any) => updateField("firstName", e.target.value)}
              />
            </Field>
            <Field label="Last Name">
              <input
                aria-label="Last Name"
                className={inputCls}
                value={draft.lastName}
                onChange={(e: any) => updateField("lastName", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Title">
              <input
                aria-label="Title"
                className={inputCls}
                value={draft.title}
                onChange={(e: any) => updateField("title", e.target.value)}
              />
            </Field>
            <Field label="Company">
              <IconInput
                icon={<Building2 size={14} />}
                label="Company"
                value={draft.company}
                onChange={(e: any) => updateField("company", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Email">
              <IconInput
                icon={<Mail size={14} />}
                label="Email"
                type="email"
                value={draft.email}
                onChange={(e: any) => updateField("email", e.target.value)}
              />
            </Field>
            <Field label="Secondary Email">
              <IconInput
                icon={<Mail size={14} />}
                label="Secondary Email"
                type="email"
                value={draft.secondaryEmail}
                onChange={(e: any) =>
                  updateField("secondaryEmail", e.target.value)
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Phone">
              <IconInput
                icon={<Phone size={14} />}
                label="Phone"
                value={draft.phone}
                onChange={(e: any) => updateField("phone", e.target.value)}
              />
            </Field>
            <Field label="Mobile">
              <IconInput
                icon={<Phone size={14} />}
                label="Mobile"
                value={draft.mobile}
                onChange={(e: any) => updateField("mobile", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Fax">
              <IconInput
                icon={<Printer size={14} />}
                label="Fax"
                value={draft.fax}
                onChange={(e: any) => updateField("fax", e.target.value)}
              />
            </Field>
            <Field label="Website">
              <IconInput
                icon={<Globe size={14} />}
                label="Website"
                value={draft.website}
                onChange={(e: any) => updateField("website", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Skype ID">
              <input
                aria-label="Skype ID"
                className={inputCls}
                value={draft.skypeId}
                onChange={(e: any) => updateField("skypeId", e.target.value)}
              />
            </Field>
            <Field label="Twitter">
              <input
                aria-label="Twitter"
                className={inputCls}
                value={draft.twitter}
                onChange={(e: any) => updateField("twitter", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Lead Source">
              <input
                aria-label="Lead Source"
                className={inputCls}
                value={draft.leadSource}
                onChange={(e: any) => updateField("leadSource", e.target.value)}
              />
            </Field>
            <Field label="Lead Status">
              <div className="py-2">
                <span
                  className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium ${
                    STATUS_CHIP[draft.leadStatus]
                  }`}
                >
                  {draft.leadStatus}
                </span>
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Industry">
              <input
                aria-label="Industry"
                className={inputCls}
                value={draft.industry}
                onChange={(e: any) => updateField("industry", e.target.value)}
              />
            </Field>
            <Field label="Rating">
              <div className="relative">
                <select
                  aria-label="Rating"
                  className={`${inputCls} appearance-none pr-9`}
                  value={draft.rating}
                  onChange={(e: any) =>
                    updateField(
                      "rating",
                      e.target.value as ZohoLeadRating
                    )
                  }
                >
                  {RATING_OPTIONS.map((r) => (
                    <option key={r || "none"} value={r}>
                      {r || "Select Rating"}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Annual Revenue">
              <IconInput
                icon={<DollarSign size={14} />}
                label="Annual Revenue"
                value={draft.annualRevenue}
                onChange={(e: any) =>
                  updateField("annualRevenue", e.target.value)
                }
              />
            </Field>
            <Field label="No. of Employees">
              <IconInput
                icon={<Users size={14} />}
                label="No. of Employees"
                value={draft.noOfEmployees}
                onChange={(e: any) =>
                  updateField("noOfEmployees", e.target.value)
                }
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-red-500"
              checked={draft.emailOptOut}
              onChange={(e: any) => updateField("emailOptOut", e.target.checked)}
            />
            Email Opt Out
          </label>
        </div>
      </SectionCard>

      {/* Address Information */}
      <SectionCard title="Address Information" icon={<MapPin size={16} />}>
        <Field label="Address">
          <textarea
            aria-label="Address"
            rows={3}
            className={inputCls}
            placeholder="Full address (street, city, state, zip)"
            value={draft.address}
            onChange={(e: any) => updateField("address", e.target.value)}
          />
        </Field>
      </SectionCard>

      {/* Project Interest (GFS custom) */}
      <SectionCard title="Project Interest" icon={<Briefcase size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Project Interest">
            <div className="relative">
              <select
                aria-label="Project Interest"
                className={`${inputCls} appearance-none pr-9`}
                value={draft.projectInterest}
                onChange={(e: any) =>
                  updateField("projectInterest", e.target.value)
                }
              >
                {PROJECT_INTEREST_OPTIONS.map((label) => (
                  <option key={label || "none"} value={label}>
                    {label || "Select Interest"}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
            </div>
          </Field>
          <Field label="Estimated Budget">
            <IconInput
              icon={<DollarSign size={14} />}
              label="Estimated Budget"
              value={draft.estimatedBudget}
              onChange={(e: any) =>
                updateField("estimatedBudget", e.target.value)
              }
            />
          </Field>
        </div>
      </SectionCard>

      {/* Description */}
      <SectionCard title="Description Information" icon={<FileText size={16} />}>
        <textarea
          aria-label="Description"
          rows={4}
          className={inputCls}
          value={draft.description}
          onChange={(e: any) => updateField("description", e.target.value)}
        />
      </SectionCard>

      {/* Notes */}
      <SectionCard title="Notes" icon={<StickyNote size={16} />}>
        <div className="space-y-3">
          <div className="border border-gray-200 rounded-md">
            <textarea
              aria-label="Add a note"
              rows={2}
              className="w-full bg-transparent px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 outline-none resize-none"
              placeholder="Add a note…"
              value={newNote}
              onChange={(e: any) => setNewNote(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-2 py-1.5">
              <button
                type="button"
                onClick={handleAddNote}
                disabled={!newNote.trim()}
                className="px-3 py-1 text-xs bg-black text-white font-medium rounded-md hover:bg-gray-800 transition disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Add Note
              </button>
            </div>
          </div>

          {draft.notes.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {draft.notes.map((note: any) => (
                <li
                  key={note.id}
                  className="border border-gray-200 rounded-md p-3 bg-gray-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0 text-xs font-medium text-gray-600">
                      {note.author
                        .split(" ")
                        .map((p: any) => p[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-800">
                          {note.author}
                        </p>
                        <p className="text-xs text-gray-500 shrink-0">
                          {note.createdDate}
                        </p>
                      </div>
                      <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">
                        {note.content}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      {/* Emails */}
      <SectionCard title="Emails" icon={<Inbox size={16} />}>
        {draft.emails.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No emails on record.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {draft.emails.map((email: any) => (
              <li key={email.id} className="py-3 flex items-start gap-3">
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
                  <div className="flex items-center flex-wrap gap-2 mt-1">
                    <p className="text-xs text-gray-500 truncate">
                      {email.sentBy}
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                      {email.source}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-md bg-green-100 text-green-700">
                      {email.status}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Action footer */}
      <div className="fixed bottom-0 left-[250px] right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-5 py-2 text-sm bg-red-500 text-white font-medium rounded-md hover:bg-red-600 transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-gray-800 transition"
        >
          Save &amp; Continue
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

export default ZohoLeadDetail;
