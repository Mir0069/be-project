// features/estimator/workspace/components/CitationLink.tsx
import { ExternalLink, FileText, Mail } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { useDocuments } from "@/features/projects/query/documentsQuery";
import { openDocumentPreview, normalizeBBox } from "@/shared/lib/filePreview";
import type { BBoxInput, PreviewLocationOptions } from "@/shared/lib/filePreview";
import type { ApiDocument } from "@/services/documents";
import { getDocumentDisplayLabel } from "@/shared/lib/documentLabel";
import { AIReasoningLabel } from "@/features/estimator/workspace/components/AIReasoningLabel";

interface CitationLinkProps {
  projectId: string;
  citationText: string;
  docName?: string;
  pageNumber?: number;
  bboxInches?: BBoxInput;
  zoomPercent?: number;
  sourceType?: string;
  interactive?: boolean;
  className?: string;
  documentId?: string;
  searchText?: string;
}

const DOCUMENT_FILE_PATTERN = /[^\\/\\?#*:"<>|\r\n]+\.(?:pdf|docx?|xlsx?|csv|pptx?|rtf|odt|ods|odp|txt|vtt|log|json|png|jpe?g|webp|gif|svg|bmp)\b/i;

const extractDocumentFileName = (value?: string | null): string | undefined => {
  if (!value?.trim()) return undefined;

  let cleaned = value
    .replace(/^\[\s*/, "")
    .replace(/\s*\]$/, "")
    .replace(/^[📄\s]+/u, "")
    .split(/[?#]/, 1)[0]
    .trim();
  cleaned = cleaned.replace(/\s*\(p(?:age)?\.?\s*\d+\)$/i, "").replace(/\s*@.*$/, "").trim();
  const match = cleaned.match(DOCUMENT_FILE_PATTERN);
  if (match) {
    let fn = match[0].trim();
    fn = fn.replace(/^[\[(]+/, "").replace(/[\])]+$/, "").trim();
    return fn || undefined;
  }
  return undefined;
};

const normalizeSourceType = (value?: string | null): string =>
  value?.trim().toLowerCase().replace(/[\s-]+/g, "_") || "";

const isMailSourceType = (value?: string | null): boolean => {
  const sourceType = normalizeSourceType(value);
  return Boolean(sourceType) && (
    sourceType.includes("email") ||
    sourceType.includes("mail") ||
    sourceType.includes("outlook") ||
    sourceType.includes("lead_sheet") ||
    sourceType.includes("message")
  );
};

const isMailCitationName = (value?: string | null): boolean => {
  if (!value?.trim()) return false;
  const normalized = value.trim().toLowerCase().replace(/_/g, " ");
  const fileName = normalized.split(/[\\/]/).at(-1) || normalized;
  return (
    /^email[-_][^/\\]+\.txt$/i.test(fileName) ||
    /\.(?:eml|msg)$/i.test(fileName) ||
    /\b(?:email|mail)\s*(?:body|thread|message)?\b/i.test(normalized) ||
    /\bquote\s+request\b/i.test(normalized)
  );
};

const isMailDocument = (document?: ApiDocument): boolean => {
  if (!document) return false;
  const metadata = document.metadata;
  const kind = String(metadata?.kind || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (kind === "email_body" || kind === "emailbody" || metadata?.isEmailBody === true) {
    return true;
  }
  if (document.originalName?.toLowerCase().endsWith(".pdf") || document.mimeType?.toLowerCase() === "application/pdf") {
    return false;
  }
  const isGeneratedEmailText =
    /^email[-_][^/\\]+\.txt$/i.test(document.originalName) &&
    (document.mimeType?.toLowerCase() === "text/plain" ||
      Boolean(metadata?.emailId || metadata?.messageId) ||
      isMailSourceType(metadata?.source));

  return isGeneratedEmailText || isMailCitationName(document.originalName);
};

const isMailBodyCitation = (
  sourceType: string | undefined,
  docName: string | undefined,
  citationText: string,
): boolean => {
  if (docName?.toLowerCase().endsWith(".pdf") || citationText.toLowerCase().includes(".pdf")) {
    return false;
  }
  return isMailSourceType(sourceType) || isMailCitationName(docName) || isMailCitationName(citationText);
};

const isRuleEngineCitation = (
  sourceType?: string,
  docName?: string,
  citationText?: string,
): boolean => {
  const s = normalizeSourceType(sourceType);
  if (
    s === "rule_engine" ||
    s === "rules_engine" ||
    s === "rule" ||
    s === "ai_inferred" ||
    s === "ai_infered" ||
    s.includes("inferred") ||
    s.includes("infered")
  ) return true;
  const d = (docName || "").toLowerCase().trim();
  if (
    d === "rule engine" ||
    d === "rules engine" ||
    d === "rule_engine" ||
    d === "ai inferred" ||
    d === "ai infered" ||
    d.includes("inferred") ||
    d.includes("infered")
  ) return true;
  const c = (citationText || "").toLowerCase().trim();
  return (
    c === "rule engine" ||
    c === "rules engine" ||
    c.startsWith("⚙️ rule engine") ||
    c.startsWith("rule engine") ||
    c.includes("ai inferred") ||
    c.includes("ai infered") ||
    c.includes("inferred") ||
    c.includes("infered")
  );
};

const getStaticCitationLabel = (citationText: string, fallback: string): string =>
  getDocumentDisplayLabel(citationText, fallback).replace(/^📄\s*/u, "");

export const CitationLink = ({
  projectId,
  citationText,
  docName,
  pageNumber,
  bboxInches,
  zoomPercent,
  sourceType,
  interactive = false,
  className = "",
  documentId,
  searchText,
}: CitationLinkProps) => {
  const directFileName = extractDocumentFileName(docName) || extractDocumentFileName(citationText);

  // 1. Rule Engine Deduction
  if (isRuleEngineCitation(sourceType, docName, citationText)) {
    return <RuleEngineBadge className={className} />;
  }

  // 2. Email Correspondence
  const mailCitation = isMailBodyCitation(sourceType, docName, citationText);
  if (mailCitation) {
    const rawLabel = getStaticCitationLabel(citationText, "Email Thread");
    const mailLabel =
      rawLabel && !rawLabel.toLowerCase().endsWith(".txt") && !rawLabel.toLowerCase().includes("quote request")
        ? rawLabel
        : "Email Thread";
    return <EmailCitationBadge label={mailLabel} className={className} />;
  }

  const shouldResolveDocument = interactive && !mailCitation;
  const { data: documents } = useDocuments(shouldResolveDocument ? projectId : undefined);

  if (interactive) {
    const targetDoc = findMatchingDocument(docName, citationText, documents, documentId);
    const targetDocId = targetDoc?.id || (targetDoc as any)?._id || documentId;
    const targetOriginalName = targetDoc?.originalName || directFileName || docName || "document.pdf";

    if (!targetDoc && !targetDocId) {
      const fallbackLabel = directFileName;
      return fallbackLabel ? <StaticCitation fileName={fallbackLabel} className={className} /> : null;
    }

    if (targetDoc && isMailDocument(targetDoc)) {
      return (
        <EmailCitationBadge
          label={getDocumentDisplayLabel(targetDoc.originalName, directFileName || "Email Thread")}
          className={className}
        />
      );
    }

    const displayLabel = getDocumentDisplayLabel(targetOriginalName, directFileName || citationText);
    const titleLabel = getDocumentDisplayLabel(docName || citationText, "attachment");
    let resolvedPage: number | undefined = undefined;
    if (pageNumber != null) {
      const parsed = parseInt(String(pageNumber), 10);
      if (Number.isFinite(parsed) && parsed > 0) resolvedPage = parsed;
    }
    if (!resolvedPage) {
      const pageMatch = citationText.match(/p(?:age)?\.?\s*(\d+)/i);
      if (pageMatch) resolvedPage = parseInt(pageMatch[1], 10);
    }
    resolvedPage = resolvedPage || 1;

    let resolvedBbox: BBoxInput | undefined = normalizeBBox(bboxInches) || undefined;
    if (!resolvedBbox) {
      const atIdx = citationText.indexOf("@");
      if (atIdx !== -1) {
        const coords = citationText.substring(atIdx + 1).match(/[-+]?\d*\.?\d+/g);
        if (coords && coords.length >= 4) {
          resolvedBbox = normalizeBBox([
            parseFloat(coords[0]),
            parseFloat(coords[1]),
            parseFloat(coords[2]),
            parseFloat(coords[3]),
          ]);
        }
      }
    }

    const handleClick = (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      if (!targetDocId) return;
      const normalizedBbox = normalizeBBox(resolvedBbox);
      const locationOptions: PreviewLocationOptions = {
        pageNumber: resolvedPage,
        bboxInches: normalizedBbox || undefined,
        zoomPercent: zoomPercent || (normalizedBbox ? 150 : 125),
        searchText: searchText?.trim() || undefined,
      };
      if (!openDocumentPreview(targetDocId, targetOriginalName, locationOptions)) {
        showToast("error", "Please allow pop-ups to view drawing citations");
      }
    };

    return (
      <button
        type="button"
        onClick={handleClick}
        title={`Open ${titleLabel} at page ${resolvedPage || 1}`}
        className={`inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-blue-200/80 bg-blue-50/80 px-2 py-1 text-xs font-medium text-blue-700 shadow-2xs transition-colors hover:bg-blue-100/90 hover:text-blue-800 ${className}`}
      >
        <FileText size={12} className="text-blue-600 shrink-0" />
        <span className="min-w-0 truncate">{displayLabel}</span>
        <ExternalLink size={10} className="shrink-0 text-blue-400" />
      </button>
    );
  }

  const fallbackLabel = directFileName;
  return fallbackLabel ? <StaticCitation fileName={fallbackLabel} className={className} /> : null;
};

const StaticCitation = ({ fileName, className = "" }: { fileName: string; className?: string }) => (
  <span
    title={fileName}
    className={`inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-blue-200/80 bg-blue-50/80 px-2 py-1 text-xs font-medium text-blue-700 ${className}`}
  >
    <FileText size={12} className="text-blue-600 shrink-0" />
    <span className="min-w-0 truncate">{fileName}</span>
  </span>
);

const RuleEngineBadge = ({ className = "" }: { className?: string }) => {
  const tooltipText = "Non-clickable: AI inferred from engineering rules and project scope.";

  return (
    <span
      title={tooltipText}
      className={`inline-flex cursor-default ${className}`}
    >
      <AIReasoningLabel />
    </span>
  );
};

const EmailCitationBadge = ({ label = "Email Thread", className = "" }: { label?: string; className?: string }) => {
  const isEmailThread =
    label.toLowerCase().includes("email") ||
    label.toLowerCase().includes("mail") ||
    label.toLowerCase().includes("quote request") ||
    label.toLowerCase().endsWith(".txt");
  const displayLabel = isEmailThread ? "Email Thread" : label.replace(/\s*\(non-clickable\)/i, "").trim();

  const tooltipText = isEmailThread
    ? "Non-clickable: Email cannot be opened here. Please go to Outlook and check your mail."
    : `Non-clickable: ${label}`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    showToast("info", tooltipText);
  };

  return (
    <span
      onClick={handleClick}
      title={tooltipText}
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-amber-200 bg-amber-50/90 px-2 py-1 text-xs font-medium text-amber-800 shadow-2xs cursor-default ${className}`}
    >
      <Mail size={12} className="text-amber-600 shrink-0" />
      <span className="min-w-0 truncate">{displayLabel}</span>
    </span>
  );
};

const normalizeDocName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\[\d+\]/g, "")
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
};

const findMatchingDocument = (
  docName: string | undefined,
  citationText: string,
  documents?: ApiDocument[],
  documentId?: string,
): ApiDocument | undefined => {
  if (!documents || documents.length === 0) return undefined;
  if (isRuleEngineCitation(undefined, docName, citationText)) return undefined;

  // 1. If documentId is explicitly given, match by ID
  if (documentId) {
    const byId = documents.find(
      (d) => String(d.id) === String(documentId) || String((d as any)._id) === String(documentId)
    );
    if (byId) return byId;
  }

  const directFileName = extractDocumentFileName(docName) || extractDocumentFileName(citationText);
  if (directFileName) {
    const cleanFileName = normalizeDocName(directFileName);
    const matchByDirect = documents.find((d) => {
      const cleanOrig = normalizeDocName(d.originalName);
      return cleanOrig === cleanFileName || cleanOrig.includes(cleanFileName) || cleanFileName.includes(cleanOrig);
    });
    if (matchByDirect) return matchByDirect;
  }

  const trimmedDocName = docName?.trim();
  if (trimmedDocName) {
    const cleanDocName = normalizeDocName(trimmedDocName);
    const exact = documents.find((document) => {
      const cleanOrig = normalizeDocName(document.originalName);
      return cleanOrig === cleanDocName || cleanDocName === cleanOrig || cleanOrig.includes(cleanDocName) || cleanDocName.includes(cleanOrig);
    });
    if (exact) return exact;
  }

  const trimmedCitation = citationText?.trim();
  if (trimmedCitation) {
    const cleanCitation = normalizeDocName(trimmedCitation);
    if (cleanCitation.length >= 3) {
      const keywordMatch = documents.find((document) => {
        const cleanOrig = normalizeDocName(document.originalName);
        return cleanOrig === cleanCitation || cleanCitation.includes(cleanOrig) || cleanOrig.includes(cleanCitation);
      });
      if (keywordMatch) return keywordMatch;
    }
  }

  // Fallback to drawing PDF document matching typical blueprint keywords
  const blueprintKeywords = ["drawing", "plan", "architect", "cad", "design", "construction", "section", "sheet", "detail", "floor", "a-", "s-", "elevation"];
  const isDrawingCitation = blueprintKeywords.some((kw) =>
    (trimmedCitation && trimmedCitation.toLowerCase().includes(kw)) ||
    (trimmedDocName && trimmedDocName.toLowerCase().includes(kw))
  );
  if (isDrawingCitation) {
    const blueprintDoc = documents.find((d) => {
      const name = d.originalName.toLowerCase();
      return name.endsWith(".pdf") && blueprintKeywords.some((kw) => name.includes(kw));
    });
    if (blueprintDoc) return blueprintDoc;

    const firstPdf = documents.find((d) => d.originalName.toLowerCase().endsWith(".pdf"));
    if (firstPdf) return firstPdf;
  }

  return undefined;
};
