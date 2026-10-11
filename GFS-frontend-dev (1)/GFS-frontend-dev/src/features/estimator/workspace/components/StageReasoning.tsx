import type { ReactNode } from "react";
import type { ProposalStageField } from "@/shared/types/proposalStage.types";
import { CitationLink } from "@/features/estimator/workspace/components/CitationLink";
import { ConfidenceBadge, hasConfidenceValue } from "@/features/estimator/workspace/components/ConfidenceBadge";
import { formatReasoningLines } from "@/features/estimator/workspace/utils/reasoning";
import { AIReasoningLabel } from "@/features/estimator/workspace/components/AIReasoningLabel";

type StageReasoningProps = {
  field?: ProposalStageField;
  projectId?: string;
  signals?: Record<string, any>;
};

const matchedSignalForReason = (
  reason: string,
  signals?: Record<string, any>,
): any => {
  if (!signals) return undefined;

  const lowerReason = reason.toLowerCase();
  for (const [signalKey, signalValue] of Object.entries(signals)) {
    const cleanSignalKey = signalKey.toLowerCase().replace(/^is_|^has_/, "");
    if (lowerReason.includes(cleanSignalKey) || lowerReason.includes(signalKey.toLowerCase())) {
      return signalValue;
    }
  }

  return undefined;
};

const citationForReason = (
  reason: string,
  signals?: Record<string, any>,
  field?: ProposalStageField,
) => {
  const lowerReason = reason.toLowerCase();
  const pageMatch = reason.match(/p(?:age)?\.?\s*(\d+)/i);

  // 1. Check matched signal from AI signals dictionary first
  const matchedSignal = matchedSignalForReason(reason, signals);
  let signalCit = matchedSignal?.citation || matchedSignal?.extracted_citation;
  if (typeof signalCit === "string") {
    try {
      signalCit = JSON.parse(signalCit);
    } catch {}
  }

  // 2. Fall back to field citation
  let fieldCit = field?.citation || (field as any)?.extracted_citation;
  if (typeof fieldCit === "string") {
    try {
      fieldCit = JSON.parse(fieldCit);
    } catch {}
  }

  const citation = signalCit || fieldCit;

  let docName = citation?.pdf_name || citation?.doc_name;
  let pageNumber =
    citation?.page ?? citation?.page_num ?? (pageMatch ? parseInt(pageMatch[1], 10) : 1);
  if (pageNumber != null) {
    pageNumber = parseInt(String(pageNumber), 10) || 1;
  }
  let bboxInches =
    citation?.bbox_inches ||
    citation?.bbox ||
    (field as any)?.bbox_inches ||
    (field as any)?.bbox ||
    (matchedSignal as any)?.bbox_inches ||
    (matchedSignal as any)?.bbox;
  let sourceType = citation?.source_type || citation?.sourceType || citation?.source;
  let citationText = citation?.citationText || citation?.citation_text || docName;
  const documentId =
    citation?.document_id ||
    citation?.documentId ||
    (field?.citation as any)?.document_id ||
    (field?.citation as any)?.documentId;

  // If there is an explicit PDF document cited, prioritize it so it stays clickable!
  if (docName && (docName.toLowerCase().endsWith(".pdf") || citationText?.toLowerCase().includes(".pdf"))) {
    return {
      citation,
      pageNumber,
      docName,
      bboxInches,
      sourceType: "pdf",
      citationText: citationText || `${docName} (p.${pageNumber || 1})`,
      documentId,
    };
  }

  // 3. Rule Engine / AI Inferred deduction
  const isRuleReason =
    sourceType === "rule_engine" ||
    lowerReason.startsWith("rule engine") ||
    lowerReason.includes("rule engine:") ||
    lowerReason.includes("rules engine") ||
    lowerReason.includes("ai inferred") ||
    lowerReason.includes("ai infered") ||
    lowerReason.includes("->") ||
    lowerReason.includes("→") ||
    lowerReason.includes("engineering load chart") ||
    lowerReason.includes("safe default");

  if (isRuleReason) {
    return {
      citation: undefined,
      pageNumber: 1,
      docName: "AI Inferred",
      bboxInches: undefined,
      sourceType: "rule_engine",
      citationText: "AI Inferred",
      documentId: undefined,
    };
  }

  if (!docName) {
    if (lowerReason.includes("email") || lowerReason.includes("inquiry")) {
      citationText = `Email Thread (p.${pageNumber || 1})`;
      docName = "Email Thread";
      sourceType = "email_body";
    } else if (
      lowerReason.includes("drawing") ||
      lowerReason.includes("sheet") ||
      lowerReason.includes("plan") ||
      lowerReason.includes("elevation") ||
      lowerReason.includes("section") ||
      lowerReason.includes("detail")
    ) {
      citationText = `Drawing (p.${pageNumber || 1})`;
      docName = "Drawing";
      sourceType = "drawing";
    } else if (
      lowerReason.includes("vision") ||
      lowerReason.includes("canonical") ||
      lowerReason.includes("signal") ||
      lowerReason.includes("walkable") ||
      lowerReason.includes("confirmed") ||
      lowerReason.includes("standard")
    ) {
      citationText = "AI Inferred";
      docName = "AI Inferred";
      sourceType = "rule_engine";
    } else {
      citationText = "AI Inferred";
      docName = "AI Inferred";
      sourceType = "rule_engine";
    }
  }

  return {
    citation,
    pageNumber,
    docName,
    bboxInches,
    sourceType,
    citationText: citationText || docName,
    documentId,
  };
};

export const StageReasoning = ({ field, projectId, signals }: StageReasoningProps): ReactNode => {
  if (!field) return "-";

  const confidence = field.confidence ?? field.extracted_confidence;
  let reasons = formatReasoningLines(
    field.reasoning ||
    (field as any).extracted_verbatim ||
    (field as any).extracted_citation?.verbatim,
  );

  if (reasons.length === 0 && field.value != null && String(field.value).trim() !== "") {
    reasons = ["Derived from project engineering rules and application scope."];
  }

  if (reasons.length === 0) {
    return hasConfidenceValue(confidence) ? <ConfidenceBadge confidence={confidence} /> : "-";
  }

  const reasonItems = reasons.map((reason) => ({
    reason,
    citation: citationForReason(reason, signals, field),
  }));
  const hasAiReasoning = reasonItems.some(({ citation }) => citation.sourceType === "rule_engine");

  return (
    <div className="space-y-2.5">
      <ul className="space-y-2.5">
        {reasonItems.map(({ reason, citation }, index) => {
          const { pageNumber, docName, bboxInches, sourceType, citationText, documentId } = citation;
          const displayLabel = citationText || docName || "";
          const citationShouldWrap =
            displayLabel.length > 44 || reason.length > 120;
          const searchVerbatim = (citation as any)?.verbatim || (field as any)?.extracted_verbatim || (field as any)?.verbatim || (field?.value != null && String(field.value) !== "-" ? String(field.value) : undefined);
          const citationProps = {
            projectId,
            citationText: displayLabel,
            pageNumber,
            docName,
            bboxInches,
            sourceType,
            interactive: true,
            documentId: documentId || (citation as any)?.document_id || (field?.citation as any)?.document_id,
            searchText: searchVerbatim,
          };

          return (
            <li key={index} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="m-0 min-w-0 flex-1 text-sm leading-6 text-gray-600">{reason}</p>
                  {projectId && sourceType !== "rule_engine" && !citationShouldWrap && (
                    <CitationLink {...citationProps} className="shrink-0" />
                  )}
                </div>
                {projectId && sourceType !== "rule_engine" && (
                  citationShouldWrap && (
                    <div className="min-w-0">
                      <CitationLink {...citationProps} className="mt-1.5" />
                    </div>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {hasAiReasoning && (
          <AIReasoningLabel />
        )}
        <ConfidenceBadge confidence={confidence} />
      </div>
    </div>
  );
};
