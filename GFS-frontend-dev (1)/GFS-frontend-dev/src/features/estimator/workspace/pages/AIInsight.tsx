import { Lightbulb, Loader2 } from "lucide-react";
import { useOutlookEmails } from "@/features/projects/query/outlookQuery";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import { useProposalStage } from "@/features/projects/query/proposalsQuery";

import { CitationLink } from "../components/CitationLink";
import WorkspaceAnalysisStatus from "./components/WorkspaceAnalysisStatus";
import { useDocuments } from "@/features/projects/query/documentsQuery";
import { formatReasoningLines } from "@/features/estimator/workspace/utils/reasoning";
import {
  buildStageExtractionSummary,
  getStageExtractionReasoning,
  getZohoNoteSummary,
  isEmptyAttachmentValue,
  isTranscriptNoise,
} from "@/features/estimator/workspace/utils/aiInsight";
import { getVisibleProjectDocuments } from "@/shared/lib/documentLabel";

const isMongoId = (id: string) => /^[a-f\d]{24}$/i.test(id);

const AI_INSIGHT_REASONING_LABELS = [
  "AI Analysis",
  "Customer Info",
  "Location",
  "Scope",
  "Request Summary",
  "Attachments",
  "Sender Name",
  "Sender Email",
  "Company Name",
  "Project Name",
  "Project Type",
  "System",
  "Evidence",
  "Basis",
  "Source",
];

type AIInsightReasoningPoint = {
  label?: string;
  text: string;
};

const splitAIInsightReasoning = (reasoning: unknown): string[] => {
  const labelBoundary = new RegExp(
    `\\s+(?=(?:${AI_INSIGHT_REASONING_LABELS.join("|")})\\s*:)`,
    "gi",
  );
  const seen = new Set<string>();

  return formatReasoningLines(reasoning)
    .flatMap((line) => {
      const withoutTrailingPeriod = line.replace(/\.$/, "").trim();
      const isSerializedList =
        /^\[\s*(?:['"]|[^\]]+,\s*['"])/s.test(withoutTrailingPeriod) &&
        /\]\s*$/.test(withoutTrailingPeriod);
      const source = isSerializedList
        ? withoutTrailingPeriod.replace(/^\[\s*|\s*\]$/g, "")
        : line;
      const separator = isSerializedList
        ? /\s*,\s*(?=['"])/
        : /\n+|(?<=[.!?])\s+(?=[A-Z0-9])|;\s+/;

      return source
        .replace(labelBoundary, "\n")
        .split(separator)
        .map((part) => part.replace(/^['"]|['"]$/g, "").trim())
        .filter(Boolean);
    })
    .filter((line) => {
      if (isTranscriptNoise(line) || seen.has(line)) return false;
      seen.add(line);
      return true;
  });
};

const getAIInsightReasoningPoint = (line: string): AIInsightReasoningPoint => {
  const labelPattern = new RegExp(
    `^(${AI_INSIGHT_REASONING_LABELS.join("|")})\\s*:\\s*(.+)$`,
    "i",
  );
  const match = line.match(labelPattern);

  if (!match) return { text: line };

  return {
    label: match[1],
    text: match[2] ?? "",
  };
};

const cleanSummaryText = (summaryText: string): string => {
  if (!summaryText) return "";
  return summaryText
    // Clean up long Microsoft Graph / Azure email ID hashes like email-AAMkAD...=.txt
    .replace(/email-[A-Za-z0-9_\-+=]{20,}\.txt/gi, "Email Message Note (.txt)")
    // Clean up any other raw storage hashes
    .replace(/[a-f0-9]{32,}\.pdf/gi, "Document Drawing.pdf")
    .trim();
};

const renderFormattedValue = (val: string, key: string, projectId?: string) => {
  const sheetRegex = /(\[Sheet[^\]]+\])/gi;
  if (sheetRegex.test(val) && projectId) {
    const parts = val.split(sheetRegex);
    return (
      <span>
        {parts.map((part, i) => {
          if (part.startsWith("[") && part.endsWith("]")) {
            return (
              <CitationLink
                key={i}
                projectId={projectId}
                citationText={part}
                interactive
                className="mx-1 align-middle"
              />
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </span>
    );
  }
  return val;
};

const renderPlainSummary = (summaryText: string, projectId?: string, projectDocs?: any[]) => {
  if (!summaryText) return null;
  const cleaned = cleanSummaryText(summaryText);
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);

  return (
    <div className="w-full min-w-0 space-y-3 rounded-lg border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-700">
      {lines.map((line, idx) => {
        const clean = line.replace(/^[-*•]\s*/, "").trim();
        const colonIdx = clean.indexOf(":");
        if (colonIdx !== -1) {
          const key = clean.substring(0, colonIdx).trim();
          const val = clean.substring(colonIdx + 1).trim();
          const normKey = key.toLowerCase();

          // Keep empty attachment results explicit. Do this before looking at
          // project documents so an older project file cannot be mistaken for
          // an attachment on the current email.
          if (normKey.includes("attachments") && isEmptyAttachmentValue(val)) {
            return (
              <div key={idx} className="grid items-start gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-2">
                <span className="font-semibold text-gray-900 sm:whitespace-nowrap">{key}:</span>
                <span className="min-w-0 font-normal text-gray-500">No attachments.</span>
              </div>
            );
          }

          // Render only real, active documents that are named by the AI. The
          // project document list also contains internal email-body notes and
          // unrelated files from other sources.
          if (normKey.includes("attachments")) {
            const uniqueDocs = getVisibleProjectDocuments(projectDocs || []);
            const normalizedValue = val.toLowerCase();
            const matchingDocs = uniqueDocs.filter((doc: any) => {
              const name = String(doc.originalName || doc.fileName || doc.name || "").trim();
              const baseName = name.split(/[\\/]/).pop()?.toLowerCase() || name.toLowerCase();
              return normalizedValue.includes(name.toLowerCase()) || normalizedValue.includes(baseName);
            });

            if (matchingDocs.length > 0 && projectId) {
              return (
                <div key={idx} className="grid items-start gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-2">
                  <span className="font-semibold text-gray-900 sm:whitespace-nowrap">{key}:</span>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {matchingDocs.map((doc: any) => (
                      <CitationLink
                        key={doc.id || doc._id}
                        projectId={projectId}
                        citationText={doc.originalName || doc.fileName}
                        docName={doc.originalName || doc.fileName}
                        interactive
                        pageNumber={1}
                      />
                    ))}
                  </div>
                </div>
              );
            }
          }

          return (
            <div key={idx} className="grid items-start gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-2">
              <span className="font-semibold text-gray-900 sm:whitespace-nowrap">{key}:</span>
              <span className="min-w-0 break-words font-normal text-gray-700">
                {renderFormattedValue(val, key, projectId)}
              </span>
            </div>
          );
        }
        return (
          <p key={idx} className="text-gray-700">
            {renderFormattedValue(clean, "", projectId)}
          </p>
        );
      })}
    </div>
  );
};

const AIInsight = () => {
  const { projectId } = useProjectRoute();
  const isApiProject = !!projectId && isMongoId(projectId);

  const { data: emailData, isLoading: isEmailLoading } = useOutlookEmails(
    isApiProject ? projectId : undefined
  );
  const { data: projectDocs } = useDocuments(isApiProject ? projectId : undefined);
  const { data: stageOne, isLoading: isStageLoading } = useProposalStage(
    isApiProject ? projectId : undefined,
    1,
  );

  const emails = emailData || [];
  const firstEmail = emails[0];
  const proposed = firstEmail?.proposed;
  const proposedSummary = proposed?.summary?.trim() || "";
  const proposedReasoning = proposed?.reasoning?.trim() || "";
  const fallbackSummary = buildStageExtractionSummary(stageOne?.fields_to_show);
  const fallbackReasoning = getStageExtractionReasoning(stageOne?.fields_to_show);
  const displayedReasoning = proposedReasoning || fallbackReasoning;
  const zohoSummary = getZohoNoteSummary(stageOne?.fields_to_show);

  const renderContent = () => {
    if (isApiProject) {
      if (isEmailLoading) {
        return (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
            <p className="mt-2 text-sm text-gray-500">Loading AI Insights...</p>
          </div>
        );
      }

      if (!proposedSummary && !proposedReasoning && isStageLoading) {
        return (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
            <p className="mt-2 text-sm text-gray-500">Loading AI Insights...</p>
          </div>
        );
      }

      if (!proposedSummary && !proposedReasoning && !fallbackSummary && fallbackReasoning.length === 0 && !zohoSummary) {
        return (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">No AI Insights available for this project.</p>
          </div>
        );
      }

      const reasoningLines = splitAIInsightReasoning(displayedReasoning);
      const reasoningPoints: AIInsightReasoningPoint[] = [
        ...(zohoSummary ? [{ text: zohoSummary }] : []),
        ...reasoningLines.map(getAIInsightReasoningPoint),
      ];

      return (
        <div>
          <div className="space-y-6 text-sm leading-relaxed text-gray-700">
            {(proposedSummary || fallbackSummary) && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-2">Summary</h3>
                {renderPlainSummary(proposedSummary || fallbackSummary, projectId, projectDocs)}
              </div>
            )}

            {(reasoningPoints.length > 0 || proposedReasoning) && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-2">Reasoning</h3>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  {reasoningPoints.length > 0 ? (
                    <ul className="divide-y divide-gray-200/80">
                      {reasoningPoints.map((point, index) => (
                        <li key={`${point.text}-${index}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                          {point.label ? (
                            <span className="min-w-[7.5rem] shrink-0 rounded bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                              {point.label}
                            </span>
                          ) : (
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                          )}
                          <span className="min-w-0 break-words leading-6">{point.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="whitespace-pre-wrap break-words leading-6">{proposedReasoning}</p>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      );
    }

    return (
      <div className="py-12 text-center">
        <p className="text-sm text-gray-500">No AI insights are available for this project.</p>
      </div>
    );
  };

  return (
    <div className="w-full">
      <div className="flex min-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Lightbulb size={18} className="text-red-500" />
              <h1 className="text-lg font-semibold text-gray-900">AI Insight</h1>
            </div>
            <WorkspaceAnalysisStatus />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Review the project information extracted from connected correspondence and documents.
          </p>
        </div>
        <div className="flex-1 p-6">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default AIInsight;
