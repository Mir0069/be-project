import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Check, ChevronDown, Loader2, RefreshCw, Search } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { useAuth } from "@/context/AuthContext";
// CHANGED: usePatchProposalField -> useSaveStageFields (batch update, see handleUpdate below)
import { useApproveProposalStage, useProposalStage, useSaveStageFields } from "@/features/projects/query/proposalsQuery";
import type { ProposalStageField } from "@/shared/types/proposalStage.types";
import { formatReasoningLines } from "@/features/estimator/workspace/utils/reasoning";
import { ReviseStageButton } from "@/features/estimator/workspace/pages/components/ReviseStageButton";
import { FieldFeedbackModal } from "@/features/estimator/workspace/pages/components/FieldFeedbackModal";
import { useFieldFeedbackQueue } from "@/features/estimator/workspace/hooks/useFieldFeedbackQueue";
import { toFeedbackRequests } from "@/features/estimator/workspace/utils/fieldFeedback";
import { RevisionInfo } from "@/features/estimator/workspace/pages/components/RevisionInfo";
import { useProjectRoute } from "@/features/projects/context/ProjectRouteContext";
import WorkspaceAnalysisStatus from "@/features/estimator/workspace/pages/components/WorkspaceAnalysisStatus";
import { ConfidenceBadge, hasConfidenceValue } from "@/features/estimator/workspace/components/ConfidenceBadge";
import { AIReasoningLabel } from "@/features/estimator/workspace/components/AIReasoningLabel";

const FIELD_ORDER = [
  "project_name",
  "project_address",
  "contact_name",
  "contact_address",
  "contact_phone",
  "contact_email",
  "project_type",
  "architect",
  "homeowner",
  "drafter_designer",
  "person_quoting",
  "person_checked",
];

// Internal extraction/validation metadata and the AI's Zoho note summary are not header fields.
const HIDDEN_FIELD_KEYS = new Set(["person_checked", "header_validation", "crm_note_summary"]);

const normalizeFieldKey = (key: string): string =>
  key
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();

// Validation is internal extraction metadata, never customer-facing header data.
const isHiddenHeaderField = (key: string): boolean => {
  const normalized = normalizeFieldKey(key);
  return HIDDEN_FIELD_KEYS.has(normalized) || normalized.includes("validation");
};

const LABELS: Record<string, string> = {
  project_name: "Project Name",
  project_address: "Project Address",
  contact_name: "Customer Contact Name",
  contact_address: "Customer Address",
  contact_phone: "Customer Phone",
  contact_email: "Customer Email",
  project_type: "Project Type",
  architect: "Architect",
  homeowner: "Homeowner",
  drafter_designer: "Drafter Designer",
  person_quoting: "Person Quoting",
  person_checked: "Person Checked",
};

const REQUIRED_FIELDS = new Set([
  "project_name",
  "project_address",
  "contact_name",
  "contact_phone",
  "contact_email",
  "project_type",
]);

const COUNTRY_CODES = [
  { country: "Afghanistan", value: "+93" },
  { country: "Albania", value: "+355" },
  { country: "Algeria", value: "+213" },
  { country: "American Samoa", value: "+1-684" },
  { country: "Andorra", value: "+376" },
  { country: "Angola", value: "+244" },
  { country: "Anguilla", value: "+1-264" },
  { country: "Antigua and Barbuda", value: "+1-268" },
  { country: "Argentina", value: "+54" },
  { country: "Armenia", value: "+374" },
  { country: "Aruba", value: "+297" },
  { country: "Australia", value: "+61" },
  { country: "Austria", value: "+43" },
  { country: "Azerbaijan", value: "+994" },
  { country: "Bahamas", value: "+1-242" },
  { country: "Bahrain", value: "+973" },
  { country: "Bangladesh", value: "+880" },
  { country: "Barbados", value: "+1-246" },
  { country: "Belarus", value: "+375" },
  { country: "Belgium", value: "+32" },
  { country: "Belize", value: "+501" },
  { country: "Benin", value: "+229" },
  { country: "Bermuda", value: "+1-441" },
  { country: "Bhutan", value: "+975" },
  { country: "Bolivia", value: "+591" },
  { country: "Bosnia and Herzegovina", value: "+387" },
  { country: "Botswana", value: "+267" },
  { country: "Brazil", value: "+55" },
  { country: "British Virgin Islands", value: "+1-284" },
  { country: "Brunei", value: "+673" },
  { country: "Bulgaria", value: "+359" },
  { country: "Burkina Faso", value: "+226" },
  { country: "Burundi", value: "+257" },
  { country: "Cambodia", value: "+855" },
  { country: "Cameroon", value: "+237" },
  { country: "Canada", value: "+1" },
  { country: "Cape Verde", value: "+238" },
  { country: "Cayman Islands", value: "+1-345" },
  { country: "Central African Republic", value: "+236" },
  { country: "Chad", value: "+235" },
  { country: "Chile", value: "+56" },
  { country: "China", value: "+86" },
  { country: "Colombia", value: "+57" },
  { country: "Comoros", value: "+269" },
  { country: "Congo", value: "+242" },
  { country: "Cook Islands", value: "+682" },
  { country: "Costa Rica", value: "+506" },
  { country: "Croatia", value: "+385" },
  { country: "Cuba", value: "+53" },
  { country: "Curacao", value: "+599" },
  { country: "Cyprus", value: "+357" },
  { country: "Czech Republic", value: "+420" },
  { country: "Democratic Republic of the Congo", value: "+243" },
  { country: "Denmark", value: "+45" },
  { country: "Djibouti", value: "+253" },
  { country: "Dominica", value: "+1-767" },
  { country: "Dominican Republic", value: "+1-809" },
  { country: "Ecuador", value: "+593" },
  { country: "Egypt", value: "+20" },
  { country: "El Salvador", value: "+503" },
  { country: "Equatorial Guinea", value: "+240" },
  { country: "Eritrea", value: "+291" },
  { country: "Estonia", value: "+372" },
  { country: "Eswatini", value: "+268" },
  { country: "Ethiopia", value: "+251" },
  { country: "Falkland Islands", value: "+500" },
  { country: "Faroe Islands", value: "+298" },
  { country: "Fiji", value: "+679" },
  { country: "Finland", value: "+358" },
  { country: "France", value: "+33" },
  { country: "French Guiana", value: "+594" },
  { country: "French Polynesia", value: "+689" },
  { country: "Gabon", value: "+241" },
  { country: "Gambia", value: "+220" },
  { country: "Georgia", value: "+995" },
  { country: "Germany", value: "+49" },
  { country: "Ghana", value: "+233" },
  { country: "Gibraltar", value: "+350" },
  { country: "Greece", value: "+30" },
  { country: "Greenland", value: "+299" },
  { country: "Grenada", value: "+1-473" },
  { country: "Guadeloupe", value: "+590" },
  { country: "Guam", value: "+1-671" },
  { country: "Guatemala", value: "+502" },
  { country: "Guernsey", value: "+44-1481" },
  { country: "Guinea", value: "+224" },
  { country: "Guinea-Bissau", value: "+245" },
  { country: "Guyana", value: "+592" },
  { country: "Haiti", value: "+509" },
  { country: "Honduras", value: "+504" },
  { country: "Hong Kong", value: "+852" },
  { country: "Hungary", value: "+36" },
  { country: "Iceland", value: "+354" },
  { country: "India", value: "+91" },
  { country: "Indonesia", value: "+62" },
  { country: "Iran", value: "+98" },
  { country: "Iraq", value: "+964" },
  { country: "Ireland", value: "+353" },
  { country: "Isle of Man", value: "+44-1624" },
  { country: "Israel", value: "+972" },
  { country: "Italy", value: "+39" },
  { country: "Jamaica", value: "+1-876" },
  { country: "Japan", value: "+81" },
  { country: "Jersey", value: "+44-1534" },
  { country: "Jordan", value: "+962" },
  { country: "Kazakhstan", value: "+7" },
  { country: "Kenya", value: "+254" },
  { country: "Kiribati", value: "+686" },
  { country: "Kosovo", value: "+383" },
  { country: "Kuwait", value: "+965" },
  { country: "Kyrgyzstan", value: "+996" },
  { country: "Laos", value: "+856" },
  { country: "Latvia", value: "+371" },
  { country: "Lebanon", value: "+961" },
  { country: "Lesotho", value: "+266" },
  { country: "Liberia", value: "+231" },
  { country: "Libya", value: "+218" },
  { country: "Liechtenstein", value: "+423" },
  { country: "Lithuania", value: "+370" },
  { country: "Luxembourg", value: "+352" },
  { country: "Macau", value: "+853" },
  { country: "Madagascar", value: "+261" },
  { country: "Malawi", value: "+265" },
  { country: "Malaysia", value: "+60" },
  { country: "Maldives", value: "+960" },
  { country: "Mali", value: "+223" },
  { country: "Malta", value: "+356" },
  { country: "Marshall Islands", value: "+692" },
  { country: "Martinique", value: "+596" },
  { country: "Mauritania", value: "+222" },
  { country: "Mauritius", value: "+230" },
  { country: "Mayotte", value: "+262" },
  { country: "Mexico", value: "+52" },
  { country: "Micronesia", value: "+691" },
  { country: "Moldova", value: "+373" },
  { country: "Monaco", value: "+377" },
  { country: "Mongolia", value: "+976" },
  { country: "Montenegro", value: "+382" },
  { country: "Montserrat", value: "+1-664" },
  { country: "Morocco", value: "+212" },
  { country: "Mozambique", value: "+258" },
  { country: "Myanmar", value: "+95" },
  { country: "Namibia", value: "+264" },
  { country: "Nauru", value: "+674" },
  { country: "Nepal", value: "+977" },
  { country: "Netherlands", value: "+31" },
  { country: "New Caledonia", value: "+687" },
  { country: "New Zealand", value: "+64" },
  { country: "Nicaragua", value: "+505" },
  { country: "Niger", value: "+227" },
  { country: "Nigeria", value: "+234" },
  { country: "Niue", value: "+683" },
  { country: "North Korea", value: "+850" },
  { country: "North Macedonia", value: "+389" },
  { country: "Northern Mariana Islands", value: "+1-670" },
  { country: "Norway", value: "+47" },
  { country: "Oman", value: "+968" },
  { country: "Pakistan", value: "+92" },
  { country: "Palau", value: "+680" },
  { country: "Palestine", value: "+970" },
  { country: "Panama", value: "+507" },
  { country: "Papua New Guinea", value: "+675" },
  { country: "Paraguay", value: "+595" },
  { country: "Peru", value: "+51" },
  { country: "Philippines", value: "+63" },
  { country: "Poland", value: "+48" },
  { country: "Portugal", value: "+351" },
  { country: "Puerto Rico", value: "+1-787" },
  { country: "Qatar", value: "+974" },
  { country: "Reunion", value: "+262" },
  { country: "Romania", value: "+40" },
  { country: "Russia", value: "+7" },
  { country: "Rwanda", value: "+250" },
  { country: "Saint Barthelemy", value: "+590" },
  { country: "Saint Helena", value: "+290" },
  { country: "Saint Kitts and Nevis", value: "+1-869" },
  { country: "Saint Lucia", value: "+1-758" },
  { country: "Saint Martin", value: "+590" },
  { country: "Saint Pierre and Miquelon", value: "+508" },
  { country: "Saint Vincent and the Grenadines", value: "+1-784" },
  { country: "Samoa", value: "+685" },
  { country: "San Marino", value: "+378" },
  { country: "Sao Tome and Principe", value: "+239" },
  { country: "Saudi Arabia", value: "+966" },
  { country: "Senegal", value: "+221" },
  { country: "Serbia", value: "+381" },
  { country: "Seychelles", value: "+248" },
  { country: "Sierra Leone", value: "+232" },
  { country: "Singapore", value: "+65" },
  { country: "Sint Maarten", value: "+1-721" },
  { country: "Slovakia", value: "+421" },
  { country: "Slovenia", value: "+386" },
  { country: "Solomon Islands", value: "+677" },
  { country: "Somalia", value: "+252" },
  { country: "South Africa", value: "+27" },
  { country: "South Korea", value: "+82" },
  { country: "South Sudan", value: "+211" },
  { country: "Spain", value: "+34" },
  { country: "Sri Lanka", value: "+94" },
  { country: "Sudan", value: "+249" },
  { country: "Suriname", value: "+597" },
  { country: "Sweden", value: "+46" },
  { country: "Switzerland", value: "+41" },
  { country: "Syria", value: "+963" },
  { country: "Taiwan", value: "+886" },
  { country: "Tajikistan", value: "+992" },
  { country: "Tanzania", value: "+255" },
  { country: "Thailand", value: "+66" },
  { country: "Timor-Leste", value: "+670" },
  { country: "Togo", value: "+228" },
  { country: "Tokelau", value: "+690" },
  { country: "Tonga", value: "+676" },
  { country: "Trinidad and Tobago", value: "+1-868" },
  { country: "Tunisia", value: "+216" },
  { country: "Turkey", value: "+90" },
  { country: "Turkmenistan", value: "+993" },
  { country: "Turks and Caicos Islands", value: "+1-649" },
  { country: "Tuvalu", value: "+688" },
  { country: "Uganda", value: "+256" },
  { country: "Ukraine", value: "+380" },
  { country: "United Arab Emirates", value: "+971" },
  { country: "United Kingdom", value: "+44" },
  { country: "United States", value: "+1" },
  { country: "Uruguay", value: "+598" },
  { country: "US Virgin Islands", value: "+1-340" },
  { country: "Uzbekistan", value: "+998" },
  { country: "Vanuatu", value: "+678" },
  { country: "Vatican City", value: "+379" },
  { country: "Venezuela", value: "+58" },
  { country: "Vietnam", value: "+84" },
  { country: "Wallis and Futuna", value: "+681" },
  { country: "Yemen", value: "+967" },
  { country: "Zambia", value: "+260" },
  { country: "Zimbabwe", value: "+263" },
];

const DEFAULT_COUNTRY_CODE = "+1";

const TEXT_FIELD_MAX_LENGTHS: Record<string, number> = {
  project_name: 160,
  project_address: 240,
  contact_name: 120,
  contact_address: 240,
  contact_phone: 32,
  contact_email: 254,
  project_type: 40,
  architect: 120,
  homeowner: 120,
  drafter_designer: 120,
  person_quoting: 120,
  person_checked: 120,
};

const NAME_LIKE_FIELDS = new Set([
  "contact_name",
  "architect",
  "homeowner",
  "drafter_designer",
  "person_quoting",
  "person_checked",
]);

const ADDRESS_FIELDS = new Set(["project_address", "contact_address"]);
const PROJECT_TYPE_VALUES = new Set(["RESIDENTIAL", "COMMERCIAL"]);
const PROJECT_TYPE_LABELS: Record<string, string> = {
  RESIDENTIAL: "RESIDENTIAL",
  COMMERCIAL: "COMMERCIAL",
};

const formatLabel = (key: string): string =>
  LABELS[key] ||
  key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const formatValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    const values = value
      .map((item) => formatValue(item))
      .filter((item) => item !== "Not provided");
    return values.length > 0 ? values.join(", ") : "Not provided";
  }
  if (value == null || value === "") return "Not provided";
  return String(value);
};

// Source systems sometimes return several customer phone numbers in one field.
// Keep them separate in the header so the UI does not imply they are one number.
const PHONE_NUMBER_PATTERN = /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{4}/g;

const splitPhoneValues = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitPhoneValues(item));
  }

  const text = value == null ? "" : String(value).trim();
  if (!text) return [];

  const chunks = text
    .split(/[\n;,/]+|\s+(?:and|or|&)\s+/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.flatMap((chunk) => {
    const matches = chunk.match(PHONE_NUMBER_PATTERN);
    return matches && matches.length > 0 ? matches : [chunk];
  });
};

const hasMultiplePhoneValues = (value: unknown): boolean => splitPhoneValues(value).length > 1;

const normalizeProjectTypeValue = (value: unknown): string => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return PROJECT_TYPE_VALUES.has(normalized) ? normalized : String(value ?? "").trim();
};

const formatFieldValue = (key: string, value: unknown): string => {
  if (key === "project_type") {
    const normalized = normalizeProjectTypeValue(value);
    return PROJECT_TYPE_LABELS[normalized] ?? formatValue(value);
  }

  if (key === "contact_phone") {
    const phoneValues = splitPhoneValues(value);
    return phoneValues.length > 0 ? phoneValues.join("\n") : "Not provided";
  }

  return formatValue(value);
};

const isStageField = (field: unknown): field is ProposalStageField =>
  Boolean(field) && typeof field === "object" && ("value" in field || "reasoning" in field);

const toStageField = (
  field: unknown,
  inheritedReasoning?: unknown,
): ProposalStageField | undefined => {
  if (isStageField(field)) {
    return inheritedReasoning && !field.reasoning
      ? { ...field, reasoning: inheritedReasoning as string }
      : field;
  }
  if (field == null) return undefined;
  return { value: field, reasoning: inheritedReasoning as string | undefined };
};

const getAllowedValues = (field: ProposalStageField): string[] => {
  const values = Array.isArray(field._meta?.allowed_values)
    ? field._meta.allowed_values
    : field.allowed_values;

  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
};

const isValidEmail = (value: string): boolean =>
  value.length <= 254 &&
  !value.includes("..") &&
  /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);

const isValidSinglePhone = (value: string): boolean => {
  const text = value.trim();
  const selectedCode = COUNTRY_CODES
    .map(({ value }) => value)
    .sort((a, b) => b.length - a.length)
    .find((code) => text.startsWith(code));

  if (!selectedCode) return false;

  const phoneNumber = text.slice(selectedCode.length).trim();
  const nationalDigits = phoneNumber.replace(/\D/g, "");
  const allDigits = text.replace(/\D/g, "");

  return (
    Boolean(phoneNumber) &&
    /^[\d\s().-]+$/.test(phoneNumber) &&
    nationalDigits.length >= 7 &&
    nationalDigits.length <= 12 &&
    allDigits.length <= 15
  );
};

const isValidPhone = (value: string): boolean => {
  const phoneValues = splitPhoneValues(value);
  return phoneValues.length > 0 && phoneValues.every((phone) => {
    const text = phone.trim();
    const selectedCode = COUNTRY_CODES
      .map(({ value: code }) => code)
      .sort((a, b) => b.length - a.length)
      .find((code) => text.startsWith(code));

    // The editor adds the selected country code for a single national number.
    // Multiple source numbers may be national-format values, so validate each
    // number independently instead of applying a combined 15-digit limit.
    return selectedCode ? isValidSinglePhone(text) : (
      /^[\d\s().-]+$/.test(text) &&
      text.replace(/\D/g, "").length >= 7 &&
      text.replace(/\D/g, "").length <= 12
    );
  });
};

const splitPhoneValue = (value: unknown) => {
  const text = value == null ? "" : String(value).trim();
  const selectedCode = COUNTRY_CODES
    .map(({ value }) => value)
    .sort((a, b) => b.length - a.length)
    .find((code) => text.startsWith(code));

  if (!text) {
    return { countryCode: DEFAULT_COUNTRY_CODE, phoneNumber: "" };
  }

  if (selectedCode) {
    return {
      countryCode: selectedCode,
      phoneNumber: text.slice(selectedCode.length).trim(),
    };
  }

  return { countryCode: DEFAULT_COUNTRY_CODE, phoneNumber: text.replace(/^\+/, "").trim() };
};

const buildPhoneValue = (countryCode: string, phoneNumber: string): string => {
  const normalizedNumber = phoneNumber.replace(/[^\d\s().-]/g, "").trim();
  return normalizedNumber ? `${countryCode} ${normalizedNumber}` : "";
};

const hasInvalidProjectText = (value: string): boolean =>
  /[\x00-\x1F\x7F<>]/.test(value);

const hasLetter = (value: string): boolean => /[A-Za-z]/.test(value);

const getFieldValidationError = (
  key: string,
  value: unknown,
  field: ProposalStageField,
  required: boolean
): string | undefined => {
  const textValue = value == null ? "" : String(value).trim();

  if (required && REQUIRED_FIELDS.has(key) && !textValue) {
    return "This field is required.";
  }

  if (!textValue) return undefined;

  const maxLength = TEXT_FIELD_MAX_LENGTHS[key];
  if (maxLength && textValue.length > maxLength) {
    return `Keep this under ${maxLength} characters.`;
  }

  if (hasInvalidProjectText(textValue)) {
    return "Remove invalid characters.";
  }

  if (key === "contact_email" && !isValidEmail(textValue)) {
    return "Enter a valid email address.";
  }

  if (key === "contact_phone" && !isValidPhone(textValue)) {
    return "Select a country code and enter a valid phone number.";
  }

  if (key === "project_type" && !PROJECT_TYPE_VALUES.has(textValue.toUpperCase())) {
    return "Project type must be RESIDENTIAL or COMMERCIAL.";
  }

  if (NAME_LIKE_FIELDS.has(key) && !hasLetter(textValue)) {
    return "Enter a valid name.";
  }

  if (ADDRESS_FIELDS.has(key) && textValue.length < 5) {
    return "Enter a complete address.";
  }

  const allowedValues = getAllowedValues(field);
  const valueForAllowedCheck = key === "project_type"
    ? normalizeProjectTypeValue(textValue)
    : textValue;
  const allowedValuesForCheck = key === "project_type"
    ? allowedValues.map(normalizeProjectTypeValue)
    : allowedValues;

  if (allowedValuesForCheck.length > 0 && !allowedValuesForCheck.includes(valueForAllowedCheck)) {
    return `Select one of: ${allowedValues.join(", ")}.`;
  }

  return undefined;
};

import { CitationLink } from "@/features/estimator/workspace/components/CitationLink";

const renderReasoningLine = (
  text: string,
  field?: ProposalStageField,
  projectId?: string,
  key?: string,
  signals?: Record<string, any>,
  showCitation = true,
): ReactNode => {
  if (!projectId) return text;

  let pageNumber: number | undefined;
  let docName: string | undefined;
  let bboxInches: [number, number, number, number] | undefined;
  let sourceType: string | undefined;
  let label = "View Source";

  const lowerText = text.toLowerCase();
  const lowerKey = (key || "").toLowerCase();

  // 1. Check if this is a rule-engine / AI-inferred reasoning
  const isRule =
    lowerKey === "project_type" ||
    lowerText.includes("rule engine") ||
    lowerText.includes("rules engine") ||
    lowerText.includes("ai inferred") ||
    lowerText.includes("ai infered") ||
    lowerText.includes("classification derived") ||
    lowerText.includes("business rule");

  if (isRule) {
    return <span>{text}</span>;
  }

  // 2. Check dynamic pipeline citation first
  let pipelineCit = (field as any)?.citation;
  if (!pipelineCit) {
    pipelineCit = (field as any)?.extracted_citation;
  }
  if (typeof pipelineCit === "string") {
    try {
      pipelineCit = JSON.parse(pipelineCit);
    } catch {}
  }
  let extractedCit = (field as any)?.extracted_citation;
  if (typeof extractedCit === "string") {
    try {
      extractedCit = JSON.parse(extractedCit);
    } catch {}
  }

  if (pipelineCit && typeof pipelineCit === "object") {
    pageNumber = pipelineCit.page ?? pipelineCit.page_num ?? pageNumber;
    docName = pipelineCit.pdf_name ?? pipelineCit.doc_name ?? docName;
    sourceType = pipelineCit.source_type || pipelineCit.sourceType || pipelineCit.source;
    if (pipelineCit.bbox_inches || pipelineCit.bbox) {
      bboxInches = pipelineCit.bbox_inches || pipelineCit.bbox;
    }
  }

  if (!bboxInches && extractedCit && typeof extractedCit === "object") {
    bboxInches = extractedCit.bbox_inches || extractedCit.bbox;
    pageNumber = pageNumber ?? extractedCit.page ?? extractedCit.page_num;
    docName = docName ?? extractedCit.pdf_name ?? extractedCit.doc_name;
  }

  if (!bboxInches && (field as any)?.bbox_inches) {
    bboxInches = (field as any).bbox_inches;
  }
  if (!bboxInches && (field as any)?.bbox) {
    bboxInches = (field as any).bbox;
  }

  // 2b. Check signal citation if available
  let sigCit: any = null;
  if (signals && key) {
    const sig = signals[key] || signals[`${key}_name`];
    sigCit = sig?.citation || sig?.extracted_citation;
    if (typeof sigCit === "string") {
      try {
        sigCit = JSON.parse(sigCit);
      } catch {}
    }
    if (sigCit && typeof sigCit === "object") {
      pageNumber = pageNumber ?? sigCit.page ?? sigCit.page_num;
      docName = docName ?? sigCit.pdf_name ?? sigCit.doc_name;
      sourceType = sourceType ?? sigCit.source_type ?? sigCit.sourceType ?? sigCit.source;
      if (!bboxInches) {
        bboxInches = sigCit.bbox_inches || sigCit.bbox;
      }
    }
    if (!pageNumber && sig?.page) pageNumber = sig.page;
    if (!bboxInches && sig?.bbox_inches) bboxInches = sig.bbox_inches;
    if (!bboxInches && sig?.bbox) bboxInches = sig.bbox;
  }

  // Check if explicit rule engine citation was passed
  if (sourceType === "rule_engine" || sourceType === "rule" || docName?.toLowerCase() === "rule engine" || docName?.toLowerCase() === "ai inferred") {
    return <span>{text}</span>;
  }

  // If we have an explicit PDF name from the citation, prioritize it so it stays clickable!
  const directPdf = docName && docName.toLowerCase().endsWith(".pdf") ? docName : undefined;

  // 3. Fallback coordinates and format label
  if (directPdf) {
    sourceType = "pdf";
    pageNumber = pageNumber || 1;
    const cleanPdf = directPdf.replace(/\[\d+\]/g, "").replace(/\.pdf$/i, "").trim();
    label = `📄 ${cleanPdf} (p.${pageNumber || 1})`;
  } else if (lowerText.includes("title block") || lowerKey === "architect") {
    label = `📄 Title Block (p.${pageNumber || 1})`;
    docName = docName || "A07.54B";
    pageNumber = pageNumber || 1;
  } else if (
    lowerText.includes("email") ||
    lowerText.includes("inquir") ||
    lowerText.includes("from line") ||
    lowerText.includes("office line") ||
    lowerText.includes("correspondence") ||
    lowerKey.includes("contact") ||
    lowerKey === "project_address" ||
    lowerKey === "project_name"
  ) {
    label = "Email Thread";
    docName = "Email Thread";
    sourceType = "email_body";
  } else if (lowerText.includes("section") || lowerText.includes("drawing") || lowerText.includes("sheet")) {
    const pageMatch = text.match(/p(?:age)?\.?\s*(\d+)/i);
    pageNumber = pageNumber || (pageMatch ? parseInt(pageMatch[1], 10) : 1);
    label = `📄 Drawing (p.${pageNumber})`;
  } else if (pageNumber) {
    label = `📄 Source (p.${pageNumber})`;
  }

  const isEmail = !directPdf && (sourceType === "email_body" || sourceType === "email" || label.includes("Email Thread") || docName === "Email Thread");
  const shouldRenderCitation = Boolean(pageNumber || directPdf || isEmail);
  const resolvedDocumentId =
    pipelineCit?.document_id ||
    pipelineCit?.documentId ||
    extractedCit?.document_id ||
    extractedCit?.documentId ||
    sigCit?.document_id ||
    sigCit?.documentId ||
    (field as any)?.document_id ||
    (field as any)?.documentId;
  const searchVerbatim = pipelineCit?.verbatim || sigCit?.verbatim || (field as any)?.extracted_verbatim || (text && text !== "-" ? text : undefined);

  return (
    <div className="space-y-1.5">
      <span>{text}</span>
      {showCitation && shouldRenderCitation && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium uppercase tracking-wide text-slate-400">Source</span>
          <CitationLink
            projectId={projectId}
            citationText={label}
            docName={directPdf || docName}
            pageNumber={pageNumber}
            bboxInches={bboxInches}
            sourceType={sourceType}
            interactive={!isEmail}
            documentId={resolvedDocumentId}
            searchText={searchVerbatim}
          />
        </div>
      )}
    </div>
  );
};

const getFieldReasoning = (
  field: ProposalStageField | undefined,
  key: string,
  fields: Record<string, unknown> | undefined,
): unknown => {
  // 1. Direct field reasoning
  if (field?.reasoning && (Array.isArray(field.reasoning) ? field.reasoning.length > 0 : Boolean(field.reasoning))) {
    return field.reasoning;
  }

  // 2. Direct property on field like extracted_reasoning
  const rawField = field as Record<string, unknown> | undefined;
  if (rawField?.extracted_reasoning) return rawField.extracted_reasoning;

  // 3. Look in signals or _signals or header_signals
  const signals = (fields?._signals || fields?.signals || fields?.header_signals) as Record<string, any> | undefined;
  const keyAliases: Record<string, string[]> = {
    architect: ["architect", "architect_name"],
    project_name: ["project_name", "projectName"],
    project_address: ["project_address", "projectAddress", "location", "address"],
    contact_name: ["contact_name", "contactName", "customer_name", "customerName", "sender_name", "senderName"],
    contact_phone: ["contact_phone", "contactPhone", "phone"],
    contact_email: ["contact_email", "contactEmail", "email", "sender_email", "senderEmail"],
    project_type: ["project_type", "projectType"],
    drafter_designer: ["drafter_designer", "drafter", "designer"],
    homeowner: ["homeowner"],
    person_quoting: ["person_quoting"],
    person_checked: ["person_checked"],
  };

  const aliases = keyAliases[key] || [key];
  if (signals) {
    for (const alias of aliases) {
      const sig = signals[alias];
      if (sig) {
        if (typeof sig === "string" && sig.trim()) return sig;
        if (sig.reasoning) return sig.reasoning;
        if (sig.extracted_reasoning) return sig.extracted_reasoning;
      }
    }
  }

  // 4. Look for composite reasoning in fields.reasoning, stage reasoning, or _signals.reasoning
  const compositeReasoning = (fields?.reasoning || (fields as any)?._reasoning || signals?.reasoning) as string | undefined;
  if (typeof compositeReasoning === "string" && compositeReasoning.trim()) {
    // Split pipe-delimited chunks
    const chunks = compositeReasoning.split(/\s*\|\s*/);
    for (const chunk of chunks) {
      const cleanChunk = chunk.replace(/^Header Extraction:\s*/i, "").trim();
      for (const alias of aliases) {
        const prefixRegex = new RegExp(`^${alias}\\s*:\\s*(.+)`, "i");
        const match = cleanChunk.match(prefixRegex);
        if (match && match[1]?.trim()) {
          return match[1].trim();
        }
      }
    }
  }

  // 5. Contextual fallback when field has a valid value
  if (field?.value != null && String(field.value).trim() !== "") {
    switch (key) {
      case "project_name":
        return ["Project name identified from client inquiry and correspondence."];
      case "project_address":
        return ["Site address specified in project correspondence and intake details."];
      case "contact_name":
        return ["Customer contact name identified from correspondence."];
      case "contact_address":
        return ["Billing and contact address provided in intake details."];
      case "contact_email":
        return ["Sender contact email provided in client inquiry."];
      case "contact_phone":
        return ["Client contact phone number provided for coordination."];
      case "project_type":
        return ["Project classification derived from scope of work."];
      case "architect":
        return ["Architectural firm identified in project documentation."];
      default:
        return ["Specified in project intake documentation."];
    }
  }

  return undefined;
};

const formatReasoning = (
  field?: ProposalStageField,
  projectId?: string,
  key?: string,
  fields?: Record<string, unknown>,
): ReactNode => {
  if (!field) return "-";
  const confidence = field.confidence ?? field.extracted_confidence;

  const reasoningData = getFieldReasoning(field, key || "", fields) || 
    (field as any).extracted_verbatim || 
    (field as any).extracted_citation?.verbatim;
  const reasons = formatReasoningLines(reasoningData);

  if (reasons.length > 0) {
    const signals = (fields?._signals || fields?.signals || fields?.header_signals) as Record<string, any> | undefined;
    const hasRuleReasoning = reasons.some((part) => {
      const lowerPart = part.toLowerCase();
      return key === "project_type" ||
        lowerPart.includes("rule engine") ||
        lowerPart.includes("rules engine") ||
        lowerPart.includes("ai inferred") ||
        lowerPart.includes("classification derived") ||
        lowerPart.includes("business rule");
    });
    return (
      <div className="space-y-2">
        <ul className="list-disc space-y-1.5 pl-4 text-gray-600">
          {reasons.map((part, index) => (
            <li key={index} className="leading-relaxed">
              {renderReasoningLine(part, field, projectId, key, signals, index === 0)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {hasRuleReasoning && (
            <AIReasoningLabel />
          )}
          <ConfidenceBadge confidence={confidence} />
        </div>
      </div>
    );
  }

  return hasConfidenceValue(confidence) ? <ConfidenceBadge confidence={confidence} /> : "-";
};

type CountryCodeComboboxProps = {
  value: string;
  hasError: boolean;
  onChange: (value: string) => void;
};

const CountryCodeCombobox = ({ value, hasError, onChange }: CountryCodeComboboxProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredCountries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return COUNTRY_CODES;

    return COUNTRY_CODES.filter((country) =>
      `${country.country} ${country.value}`.toLowerCase().includes(normalizedQuery)
    );
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;

    searchRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Country code"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={`flex h-9 w-20 items-center justify-between rounded-md border bg-white px-2 text-sm font-medium text-gray-800 transition focus:outline-none focus:ring-2 focus:ring-red-100 ${hasError ? "border-red-400" : isOpen ? "border-red-400" : "border-gray-300 hover:border-gray-400"
          }`}
      >
        <span className="truncate">{value}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 z-30 mt-1.5 w-72 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Search size={14} className="shrink-0 text-gray-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search country or code"
              className="w-full bg-transparent text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none"
            />
          </div>

          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filteredCountries.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-400">No country code found</li>
            ) : (
              filteredCountries.map((country) => {
                const optionId = `${country.country}-${country.value}`;
                const isSelected = country.value === value;

                return (
                  <li key={optionId} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => handleSelect(country.value)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${isSelected ? "bg-red-50 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                        }`}
                    >
                      <span className="truncate">{country.country}</span>
                      <span className="shrink-0 font-semibold text-gray-900">{country.value}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

const getOrderedKeys = (fields: Record<string, unknown>) => {
  const visibleKeys = Object.keys(fields).filter((key) => {
    const lowerKey = normalizeFieldKey(key);
    return (
      lowerKey !== "signals" &&
      lowerKey !== "signal" &&
      lowerKey !== "reasoning" &&
      lowerKey !== "_reasoning" &&
      lowerKey !== "quote_number" &&
      lowerKey !== "quotenumber" &&
      !isHiddenHeaderField(key) &&
      !lowerKey.includes("signal")
    );
  });

  const ordered = FIELD_ORDER.filter((key) => visibleKeys.includes(key));
  const remaining = visibleKeys.filter((key) => !FIELD_ORDER.includes(key));

  return [...ordered, ...remaining];
};

const ProjectHeader = () => {
  const navigate = useNavigate();
  const { projectId, publicProjectKey } = useProjectRoute();
  // Approval is an estimator action; sales managers can review the stage.
  const { isSalesManager } = useAuth();
  const { data: stage, isLoading, isError, refetch } = useProposalStage(projectId, 1);
  const {
    mutateAsync: approveStageAsync,
    isPending: isApproving,
    isError: isApproveError,
    isSuccess: isApproveSuccess,
  } = useApproveProposalStage();
  // CHANGED: patchField (singular, one PATCH per field) -> saveFields (batch, one PUT for all pending fields)
  const { mutateAsync: saveFields, isPending: isPatching } = useSaveStageFields();
  const { collect: collectFeedback, modalProps: feedbackModalProps } = useFieldFeedbackQueue();
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({});
  const [phoneCountryCode, setPhoneCountryCode] = useState<string | null>(null);
  const [hasAttemptedApproval, setHasAttemptedApproval] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-red-500" />
        <p className="mt-3 text-sm text-gray-500">Loading project header data...</p>
      </div>
    );
  }

  if (isError || !stage) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <AlertCircle className="mx-auto h-7 w-7 text-red-400" />
        <p className="mt-3 text-sm text-gray-600">
          Could not load project header data.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  const fields = stage.fields_to_show as Record<string, unknown>;
  const fieldKeys = getOrderedKeys(fields);
  const isApproved = stage.status?.toUpperCase() === "APPROVED" || isApproveSuccess;
  const isLocked = stage.status?.toUpperCase() === "LOCKED";
  const nextPath = `/projects/${encodeURIComponent(publicProjectKey ?? "")}/glass-type`;
  const phonePath = "stage_1.contact_phone";
  const phoneField = toStageField(fields.contact_phone);
  const rawPhoneValue = phoneField?.value == null ? "" : String(phoneField.value).trim();
  const phoneNeedsCountryCode =
    Boolean(rawPhoneValue) &&
    !rawPhoneValue.startsWith("+") &&
    !hasMultiplePhoneValues(rawPhoneValue) &&
    !(phonePath in pendingChanges);
  const rawPhoneParts = splitPhoneValue(rawPhoneValue);
  const effectivePendingChanges = phoneNeedsCountryCode
    ? {
      ...pendingChanges,
      [phonePath]: buildPhoneValue(
        phoneCountryCode ?? rawPhoneParts.countryCode,
        rawPhoneParts.phoneNumber
      ),
    }
    : pendingChanges;

  const setPhonePendingChange = (countryCode: string, phoneNumber: string) => {
    setPhoneCountryCode(countryCode);
    const nextValue = buildPhoneValue(countryCode, phoneNumber);
    setPendingChanges((current) => {
      const next = { ...current };
      if (nextValue) {
        next[phonePath] = nextValue;
      } else {
        delete next[phonePath];
      }
      return next;
    });
  };

  const fieldErrors = fieldKeys.reduce<Record<string, string>>((errors, key) => {
    const field = toStageField(fields[key]);
    if (!field) return errors;

          const value = effectivePendingChanges[`stage_1.${key}`] ?? field.value;
    const error = getFieldValidationError(key, value, field, hasAttemptedApproval);
    if (error) errors[key] = error;
    return errors;
  }, {});

  const approvalErrors = fieldKeys.reduce<Record<string, string>>((errors, key) => {
    const field = toStageField(fields[key]);
    if (!field) return errors;

    const value = effectivePendingChanges[`stage_1.${key}`] ?? field.value;
    const error = getFieldValidationError(key, value, field, true);
    if (error) errors[key] = error;
    return errors;
  }, {});

  const hasPendingValidationErrors = Object.keys(effectivePendingChanges).some((path) => {
    const key = path.replace(/^stage_1\./, "");
    const field = toStageField(fields[key]);
    if (!field) return false;

    return Boolean(getFieldValidationError(key, effectivePendingChanges[path], field, false));
  });

  const handleApprove = async () => {
    if (!projectId) return;
    setHasAttemptedApproval(true);
    if (Object.keys(effectivePendingChanges).length > 0) {
      showToast("error", "You have unsaved changes. Please update first.");
      return;
    }
    if (Object.keys(approvalErrors).length > 0) {
      showToast("error", "Please fix the highlighted fields before approving.");
      return;
    }
    if (isApproved) {
      navigate(nextPath, { state: { refreshWorkflowStage: 2 } });
      return;
    }

    try {
      await approveStageAsync({ projectId, stage: 1 });
      await refetch();
      showToast("success", "Project Header approved successfully.");
      navigate(nextPath, { state: { refreshWorkflowStage: 2 } });
    } catch (error) {
      // Global hook onError will show the toast
    }
  };

  // CHANGED: previously fired one patchField(...) call per pending field via Promise.all,
  // which sent parallel PATCH requests that raced against each other on the backend's
  // read-modify-write and caused "Failed to update fields" when 2+ fields were edited together.
  // Now sends all pending changes in a single saveFields(...) call (one PUT request,
  // one atomic read-modify-write on the backend).
  const handleUpdate = async () => {
    if (!projectId || Object.keys(effectivePendingChanges).length === 0) return;

    const answers = await collectFeedback(
      toFeedbackRequests(
        Object.entries(effectivePendingChanges).map(([path, value]) => {
          const key = path.replace(/^stage_1\./, "");
          const previousValue = toStageField(fields[key])?.value ?? null;
          const feedbackPreviousValue = key === "contact_phone" && previousValue && !hasMultiplePhoneValues(previousValue)
            ? buildPhoneValue(rawPhoneParts.countryCode, rawPhoneParts.phoneNumber)
            : previousValue;
          return {
            key: path,
            label: LABELS[key] ?? key,
            previousValue: key === "project_type"
              ? normalizeProjectTypeValue(previousValue)
              : feedbackPreviousValue,
            newValue: key === "project_type"
              ? normalizeProjectTypeValue(value)
              : value,
          };
        })
      )
    );

    try {
      const fieldsToSave = Object.entries(effectivePendingChanges).map(([path, value]) => ({
        fieldPath: path,
        value: path === "stage_1.project_type" ? normalizeProjectTypeValue(value) : value,
        ...(answers[path] ? { feedback: answers[path]! } : {}),
      }));
      await saveFields({ projectId, stage: 1, fields: fieldsToSave });
      showToast("success", "Fields updated successfully!");
      setPendingChanges({});
      refetch();
    } catch {
      showToast("error", "Failed to update fields. Please try again.");
    }
  };
  // END CHANGED

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <FieldFeedbackModal {...feedbackModalProps} />
      <div className="flex shrink-0 items-start justify-between border-l-4 border-red-500 px-5 py-1">
        <h2 className="text-2xl font-semibold leading-8 text-red-500">
          Project Header Data
        </h2>
        <WorkspaceAnalysisStatus />
      </div>

      <section className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="bg-[#07111f] text-white">
              <th className="w-1/4 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                Parameter
              </th>
              <th className="w-1/4 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                Value
              </th>
              <th className="w-1/2 px-5 py-3.5 text-[13px] font-semibold uppercase tracking-wide">
                Reasoning
              </th>
            </tr>
          </thead>
          <tbody>
            {fieldKeys.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-5 text-sm italic text-gray-400">
                  No project header fields returned by backend.
                </td>
              </tr>
            ) : (
              fieldKeys.map((key) => {
                const field = toStageField(fields[key]);
                if (!field) return null;
                const fieldPath = `stage_1.${key}`;
                const currentValue = effectivePendingChanges[fieldPath] ?? field.value;
                const phoneParts = key === "contact_phone"
                  ? { ...splitPhoneValue(currentValue), countryCode: phoneCountryCode ?? splitPhoneValue(currentValue).countryCode }
                  : null;
                const phoneValues = key === "contact_phone" ? splitPhoneValues(currentValue) : [];
                const hasMultiplePhones = phoneValues.length > 1;

                return (
                  <tr key={key} className="border-t border-gray-100 text-gray-700 odd:bg-white even:bg-gray-50/60">
                    <td className="px-5 py-3.5 align-top text-sm font-semibold text-gray-900">
                      {formatLabel(key)}
                    </td>
                    <td className={`break-words border-l border-gray-100 px-5 py-3.5 align-top text-sm font-semibold text-gray-900 ${key === "contact_phone" ? "whitespace-pre-line" : ""}`}>
                      {isApproved || isLocked ? (
                        formatFieldValue(key, currentValue)
                      ) : (
                        <div>
                          {key === "contact_phone" && hasMultiplePhones ? (
                            <div>
                              <textarea
                                rows={Math.min(phoneValues.length, 4)}
                                value={phoneValues.join("\n")}
                                onChange={(e) => setPendingChanges({ ...pendingChanges, [fieldPath]: e.target.value })}
                                aria-label="Customer phone numbers"
                                aria-invalid={Boolean(fieldErrors[key])}
                                className={`w-full resize-y rounded-md border p-1.5 text-sm font-medium text-gray-800 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 ${fieldErrors[key] ? "border-red-400" : "border-gray-300"}`}
                              />
                              <p className="mt-1 text-xs font-normal text-gray-500">
                                Multiple phone numbers detected. Keep one number per line.
                              </p>
                            </div>
                          ) : key === "contact_phone" && phoneParts ? (
                            <div className="flex gap-2">
                              <CountryCodeCombobox
                                value={phoneParts.countryCode}
                                hasError={Boolean(fieldErrors[key])}
                                onChange={(nextCode) => setPhonePendingChange(nextCode, phoneParts.phoneNumber)}
                              />
                              <input
                                type="tel"
                                value={phoneParts.phoneNumber}
                                onChange={(e) => setPhonePendingChange(phoneParts.countryCode, e.target.value)}
                                aria-invalid={Boolean(fieldErrors[key])}
                                className={`h-9 min-w-0 flex-1 rounded-md border px-2 text-sm font-medium text-gray-800 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 ${fieldErrors[key] ? "border-red-400" : "border-gray-300"}`}
                              />
                            </div>
                          ) : getAllowedValues(field).length > 0 ? (
                            <select
                              value={key === "project_type"
                                ? normalizeProjectTypeValue(currentValue)
                                : String(currentValue ?? "")}
                              onChange={(e) => {
                                const nextValue = key === "project_type"
                                  ? normalizeProjectTypeValue(e.target.value)
                                  : e.target.value;

                                const originalValue = key === "project_type"
                                  ? normalizeProjectTypeValue(field.value)
                                  : String(field.value ?? "");

                                setPendingChanges((current) => {
                                  const next = { ...current };
                                  if (nextValue === originalValue) {
                                    delete next[fieldPath];
                                  } else {
                                    next[fieldPath] = nextValue;
                                  }
                                  return next;
                                });
                              }}
                              aria-invalid={Boolean(fieldErrors[key])}
                              className={`w-full rounded-md border p-1.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 ${fieldErrors[key] ? "border-red-400" : "border-gray-300"}`}
                            >
                              <option value="">Select {formatLabel(key).toLowerCase()}</option>
                              {getAllowedValues(field).map((value) => (
                                <option key={value} value={value}>
                                  {key === "project_type" ? formatFieldValue(key, value) : value}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={key === "contact_email" ? "email" : key === "contact_phone" ? "tel" : "text"}
                              value={String(currentValue ?? "")}
                              onChange={(e) => setPendingChanges({ ...pendingChanges, [fieldPath]: e.target.value })}
                              aria-invalid={Boolean(fieldErrors[key])}
                              className={`w-full rounded-md border p-1.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 ${fieldErrors[key] ? "border-red-400" : "border-gray-300"}`}
                            />
                          )}
                          {fieldErrors[key] && (
                            <p className="mt-1 text-xs text-red-600">{fieldErrors[key]}</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="border-l border-gray-100 px-5 py-3.5 align-top text-sm leading-6">
                      {formatReasoning(field, projectId, key, fields)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      <div className="-mx-6 -mb-6 flex shrink-0 items-center justify-between border-t border-gray-200 bg-white px-6 py-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="text-sm">
          {isApproved ? (
            <div>
              <span className="text-gray-600">Stage approved successfully.</span>
              <div className="mt-1">
                <RevisionInfo
                  revisionCount={stage.revision_count}
                  latestRevision={stage.revisions?.[0]}
                />
              </div>
            </div>
          ) : isLocked ? (
            <span className="inline-flex items-center gap-1.5 text-amber-600"><AlertCircle size={16} /> This stage is locked until the previous step is approved.</span>
          ) : isApproveError ? (
            <span className="inline-flex items-center gap-1.5 text-red-500">
              <AlertCircle size={16} /> Failed to approve. Please try again.
            </span>
          ) : (
            <span className="text-gray-500">Review the extracted header data before approving.</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!isApproved && !isLocked && (
            <button
              type="button"
              disabled={isPatching || Object.keys(effectivePendingChanges).length === 0 || hasPendingValidationErrors}
              onClick={handleUpdate}
              className="inline-flex items-center gap-2 rounded-md bg-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPatching && <Loader2 size={16} className="animate-spin" />}
              Update
            </button>
          )}

          {(true) && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={isApproving || isPatching || isLocked}
              className={`inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold text-white transition ${isApproved
                  ? "bg-green-600 hover:bg-green-700"
                  : isApproving || isPatching || isLocked
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-green-600 hover:bg-green-700"
                }`}
            >
              {isApproving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Check size={16} />
              )}
              {isApproved ? "Approved" : "Approve Data"}
            </button>
          )}

          {isApproved && (
            <ReviseStageButton
              projectId={projectId!}
              stage={1}
              stageName="Project Header"
              onRevised={() => refetch()}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectHeader;
