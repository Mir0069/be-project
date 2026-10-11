import type { AuditLogCategory, AuditLogItem } from "@/shared/types/auditLog.types";

const ROLE_LABELS: Record<string, string> = {
  ESTIMATOR: "Estimator",
  SALES_MANAGER: "Sales Manager",
  SYSTEM_ADMIN: "System Admin",
  SUPER_ADMIN: "Super Admin",
};

export const CATEGORY_LABELS: Record<AuditLogCategory, string> = {
  AUTH: "Security",
  USER: "Team members",
  PROJECT: "Projects",
  DOCUMENT: "Documents",
  EXTRACTION: "AI processing",
  APPROVAL: "Approvals",
  PROPOSAL: "Proposals",
  SYSTEM: "System",
};

type ActivityCopy = {
  title: string;
  summary: string;
};

export type ActivityDetail = {
  label: string;
  value: string;
  previousValue?: string;
};

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  dueDate: "Due date",
  projectName: "Project name",
  customerName: "Customer",
  estimatedCost: "Estimated value",
  totalSqFt: "Total square feet",
  value_frame_type: "Frame type",
  value_glass_type: "Glass type",
  value_glass_thickness: "Glass thickness",
  value_num_units: "Number of units",
  value_width: "Width",
  value_length: "Length",
  value_panel_count: "Panel count",
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const toPlainLabel = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDetailValue = (key: string, value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "number") {
    if (["estimatedCost", "finalPrice", "grandTotal"].includes(key)) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
    }
    return new Intl.NumberFormat("en-US").format(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return toPlainLabel(value);
  return null;
};

export const getActivityDetails = (item: AuditLogItem): ActivityDetail[] => {
  const before = asRecord(item.before);
  const after = asRecord(item.after);
  const metadata = asRecord(item.metadata);

  if (item.action === "proposal.optional_add_on_status_updated") {
    const status = formatDetailValue("status", metadata?.status ?? after?.status);
    return status ? [{ label: "Optional add-on selection", value: status, previousValue: formatDetailValue("status", metadata?.previousStatus ?? before?.status) ?? undefined }] : [];
  }

  const changedFields = Object.keys({ ...(before ?? {}), ...(after ?? {}) })
    .filter((field) => FIELD_LABELS[field] && !sameValue(before?.[field], after?.[field]))
    .map((field) => {
      const value = formatDetailValue(field, after?.[field]);
      const previousValue = formatDetailValue(field, before?.[field]);
      return value ? { label: FIELD_LABELS[field], value, previousValue: previousValue ?? undefined } : null;
    })
    .filter((detail): detail is ActivityDetail => Boolean(detail));

  if (changedFields.length) return changedFields.slice(0, 4);

  if (item.action === "proposal.stage7_approved") {
    const finalPrice = formatDetailValue("finalPrice", metadata?.finalPrice);
    return [
      { label: "Approved", value: "Final Parameters" },
      ...(finalPrice ? [{ label: "Approved total", value: finalPrice }] : []),
    ];
  }
  if (item.action === "proposal.stage7_approver_assigned") {
    const approverEmail = typeof metadata?.approverEmail === "string" ? metadata.approverEmail : null;
    return approverEmail ? [{ label: "Approval assigned to", value: approverEmail }] : [];
  }
  return [];
};

export const isFailed = (item: AuditLogItem): boolean => {
  const statusCode = item.metadata?.statusCode;
  return item.metadata?.outcome === "FAILURE"
    || (typeof statusCode === "number" && statusCode >= 400)
    || /returned\s+[45]\d{2}/i.test(item.description)
    || /\b(failed|failure|error|could not)\b/i.test(`${item.action} ${item.description}`);
};

const actionText = (item: AuditLogItem): string =>
  `${item.action} ${item.description}`.toLowerCase();

export const getActivityCopy = (item: AuditLogItem): ActivityCopy => {
  const action = actionText(item);
  const failed = isFailed(item);

  if (action.includes("extraction") || action.includes("analysis") || action.includes("processing")) {
    if (action.includes("failed") || failed) {
      return {
        title: "AI processing could not finish",
        summary: "The project information could not be processed. It may need another attempt.",
      };
    }
    if (action.includes("completed")) {
      return {
        title: "AI processing completed",
        summary: "The project information has been read and is ready for review.",
      };
    }
    return {
      title: "AI processing started",
      summary: "smartmfgAI Everywhere is reading the project information in the background.",
    };
  }

  if (action.includes("createuser") || action.includes("user.create")) {
    return failed
      ? {
          title: "Team member could not be added",
          summary: "The new team member account was not created.",
        }
      : {
          title: "Team member added",
          summary: "A new team member account was created successfully.",
        };
  }

  if (action.includes("role.changed") || action.includes("role.updated")) {
    return {
      title: failed ? "Team member role could not be updated" : "Team member role updated",
      summary: failed
        ? "The team member’s role was not changed."
        : "A team member’s access level was changed.",
    };
  }

  if (action.includes("user.updated") || action.includes("user.status")) {
    return {
      title: failed ? "Team member could not be updated" : "Team member updated",
      summary: failed
        ? "The team member account was not changed."
        : "A team member account was updated successfully.",
    };
  }

  if (action.includes("auth.logout")) {
    return {
      title: "Signed out",
      summary: "A team member signed out of smartmfgAI Everywhere.",
    };
  }

  if (action.includes("password.reset") || action.includes("password.set")) {
    return {
      title: failed ? "Password action could not be completed" : "Password access updated",
      summary: failed
        ? "The password action was not completed."
        : "A password-related account action was completed.",
    };
  }

  if (item.category === "AUTH") {
    return {
      title: failed ? "Security action could not be completed" : "Security activity recorded",
      summary: failed
        ? "The security action was not completed."
        : "A security-related action was recorded in smartmfgAI Everywhere.",
    };
  }

  if (action.includes("document") && item.category !== "APPROVAL") {
    if (action.includes("delete") || action.includes("purged")) {
      return {
        title: failed ? "Document could not be removed" : "Document removed",
        summary: failed
          ? "The document is still available in the project."
          : "A document was removed from the project.",
      };
    }
    if (action.includes("restore")) {
      return {
        title: failed ? "Document could not be restored" : "Document restored",
        summary: failed
          ? "The document could not be restored."
          : "A document was restored to the project.",
      };
    }
    if (action.includes("move")) {
      return {
        title: failed ? "Document could not be moved" : "Document moved",
        summary: failed
          ? "The document stayed in its original location."
          : "A document was moved between projects.",
      };
    }
    if (!/(upload|staged|create|ingest)/.test(action) && !(item.metadata?.method === "POST" && /documents\/?$/i.test(String(item.metadata?.path ?? "")))) {
      return { title: failed ? "Document action could not be completed" : "Document activity recorded", summary: "An activity involving a project document was recorded." };
    }
    return {
      title: failed ? "Document could not be added" : "Document added",
      summary: failed
        ? "The document was not added to the project."
        : "A new document was added and is ready for processing.",
    };
  }

  if (item.category === "APPROVAL" || action.includes("approv")) {
    const rejected = action.includes("reject") || action.includes("unapprov");
    return {
      title: failed
        ? "Approval action could not be completed"
        : rejected
          ? "Change sent back for review"
          : "Change approved",
      summary: failed
        ? "The requested approval action was not completed."
        : rejected
          ? "A proposed change was not accepted."
          : "A proposed change was accepted and the workflow can continue.",
    };
  }

  if (action.includes("proposal")) {
    return {
      title: failed ? "Proposal update could not be completed" : "Proposal updated",
      summary: failed
        ? "The proposal was not updated."
        : "The project proposal was updated successfully.",
    };
  }

  if (action.includes("project") || action.includes("status")) {
    return {
      title: failed ? "Project update could not be completed" : "Project updated",
      summary: failed
        ? "The project was not changed."
        : "Project information or workflow status was updated.",
    };
  }

  return {
    title: failed ? "Action could not be completed" : "Activity recorded",
    summary: failed
      ? "The requested action was not completed."
      : "A workflow activity was recorded in smartmfgAI Everywhere.",
  };
};

export const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
};

export const actorLabel = (item: AuditLogItem): string => {
  if (item.actorId === "system" || item.source === "SYSTEM") return "smartmfgAI Everywhere system";
  return ROLE_LABELS[item.actorRole ?? ""] ?? item.actorEmail ?? "smartmfgAI Everywhere user";
};

export const actorEmail = (item: AuditLogItem): string | null => {
  if (!item.actorEmail || item.actorEmail === actorLabel(item)) return null;
  return item.actorEmail;
};

export const sourceLabel = (item: AuditLogItem): string => ({
  API: "Application",
  UI: "User interface",
  AI: "AI processing",
  WEBHOOK: "Connected service",
  SYSTEM: "smartmfgAI Everywhere system",
}[item.source]);


export const activityStatus = (item: AuditLogItem): "Needs attention" | "In progress" | "Completed" | "Audit record" => {
  if (isFailed(item)) return "Needs attention";
  const action = actionText(item);
  if (/completed|succeeded/.test(action)) return "Completed";
  if (/(started|processing|queued|pending)/.test(action)) return "In progress";
  if (/(approved|accepted|updated|assigned|created|added|restored|deleted|moved)/.test(action)) return "Completed";
  if (item.metadata?.outcome === "SUCCESS" || /returned\s+2\d{2}/i.test(item.description)) return "Completed";
  return "Audit record";
};
