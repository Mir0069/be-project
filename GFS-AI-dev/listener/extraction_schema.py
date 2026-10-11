# listener/extraction_schema.py
# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schema for the 6-stage extraction listener (listener/extraction_worker.py),
# reading from AZURE_SERVICE_BUS_EXTRACTION_STAGE_QUEUE_NAME (default "ai-stage-trigger").
#
# UPDATED per backend team's "GFS-AI 6-Stage Pipeline Architecture & Contracts" doc:
#
#   Stage 0 (Backend -> AI queue): jobType="PROJECT_EXTRACTION", trigger="BEGIN_EXTRACTION"
#       - projectId/correlationId are TOP-LEVEL (not nested under payload)
#       - payload = { subject, sender, documents: [{documentId, originalName, blobUrl}] }
#       - blobUrl is a FRESH 60-minute SAS URL — no more folderPath/read-from-folder.
#       - AI POSTs the full V3 Unified Schema straight back to
#         POST /api/v1/proposals/{projectId}/stages/0/run — NOT the old generic
#         /api/v1/projects/ai-result webhook.
#
#   Stages 1-6 (Backend -> AI queue): FLAT structure, no jobType/payload envelope:
#       { trigger, projectId, targetStage, triggeredAt, triggeredBy, idempotencyKey }
#       - targetStage is 2-5 for real AI-handled stages.
#       - Stage 6 (Excel) is generated NATIVELY by the backend — NO AI call is
#         ever made for it. targetStage of 6/"EXCEL" reaching this queue is a
#         contract violation and is dead-lettered by the worker without ever
#         calling FastAPI.
#       - AI POSTs results to POST /api/v1/proposals/webhooks/{projectId}/ai-stage-result
#         with { stage, status, fields_to_show }.
#
# Legacy DOCUMENT_EXTRACTION / NEW_PROJECT / folderPath-based messages have been
# REMOVED — they are not part of the new contract. If any are still in flight
# on the queue during rollout, they will fail to parse and get dead-lettered,
# which is intentional (surface it rather than silently mis-route it).
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, field_validator, ValidationInfo


# ─────────────────────────────────────────────────────────────────────────────
# Shared sub-models
# ─────────────────────────────────────────────────────────────────────────────

class DocumentEntry(BaseModel):
    """A single document reference inside a Stage 0 BEGIN_EXTRACTION payload."""
    documentId:   str
    originalName: str
    blobUrl:      str  # fresh 60-minute SAS URL, minted by backend at trigger time

    @field_validator("blobUrl")
    @classmethod
    def blob_url_must_start_with_http(cls, v: str) -> str:
        if not v.startswith("http"):
            raise ValueError(f"blobUrl must start with http(s): {v!r}")
        return v


# ─────────────────────────────────────────────────────────────────────────────
# Stage 0: BEGIN_EXTRACTION / PROJECT_EXTRACTIONN

# ─────────────────────────────────────────────────────────────────────────────

class Stage0Payload(BaseModel):
    subject:   Optional[str] = None
    sender:    Optional[str] = None
    context:   Optional[Union[str, Dict[str, Any], List[Any]]] = None
    documents: Optional[List[DocumentEntry]] = []

    @field_validator("documents")
    @classmethod
    def validate_documents(cls, v: Optional[List[DocumentEntry]], info: ValidationInfo) -> List[DocumentEntry]:
        context = info.data.get("context") if hasattr(info, "data") else None
        has_context = False
        if context:
            if isinstance(context, str) and context.strip():
                has_context = True
            elif isinstance(context, dict):
                has_context = any(
                    context.get(k)
                    for k in ["changeSummary", "zohoDescription", "zohoNotes", "teamsChatSummaries", "teamsMeetingSummaries", "emails"]
                ) or bool(context)
            elif getattr(context, "__dict__", None):
                has_context = any(
                    getattr(context, k, None)
                    for k in ["changeSummary", "zohoDescription", "zohoNotes", "teamsChatSummaries", "teamsMeetingSummaries", "emails"]
                )
            else:
                has_context = bool(context)

        if not v and not has_context:
            raise ValueError("Either documents or context must be provided for Stage 0 extraction")
        return v or []


class Stage0ExtractionMessage(BaseModel):
    """
    Backend -> AI queue message that kicks off Stage 0 extraction.

    {
        "trigger": "BEGIN_EXTRACTION",
        "jobType": "PROJECT_EXTRACTION",
        "projectId": "666666666666666666666666",
        "correlationId": "outlookEmail:AAMKADh...",
        "payload": { "subject": "...", "sender": "...", "documents": [...] }
    }
    """
    trigger:       Literal["BEGIN_EXTRACTION"]
    jobType:       Literal["PROJECT_EXTRACTION"]
    projectId:     str
    correlationId: str
    payload:       Stage0Payload


# ─────────────────────────────────────────────────────────────────────────────
# Stages 1-6: STAGE_N_APPROVED_START_N+1 (flat PipelineTriggerPayload)
# ─────────────────────────────────────────────────────────────────────────────

# Single source of truth for valid stage-approval trigger strings, shared
# with listener/extraction_worker.py so routing logic and schema never drift.
STAGE_APPROVAL_TRIGGERS = (
    "STAGE_1_APPROVED_START_2",
    "STAGE_2_APPROVED_START_3",
    "STAGE_3_APPROVED_START_4",
    "STAGE_4_APPROVED_START_5",
    "STAGE_5_APPROVED_START_6",
)


class StageApprovedMessage(BaseModel):
    """
    Backend -> AI queue message for the Stage 1-6 rules-engine loop.
    NOTE: flat structure — no jobType, no nested payload — matching the
    backend's PipelineTriggerPayload interface exactly.

    {
        "trigger": "STAGE_1_APPROVED_START_2",
        "projectId": "666666666666666666666666",
        "targetStage": 2,
        "triggeredAt": "2026-07-09T09:13:40.791Z",
        "triggeredBy": "ESTIMATOR",
        "idempotencyKey": "666666666666666666666666:STAGE_1_APPROVED_START_2"
    }

    targetStage is 2-5 for real AI-handled stages. A targetStage of 6/"EXCEL"
    means Stage 6 (native .xlsx generation, no AI call) — that should never
    legitimately reach this queue. It's accepted here (not rejected at parse
    time) purely so the worker can recognize it and dead-letter it cleanly
    with a clear log line, instead of failing schema validation with a
    confusing error.
    """
    trigger:        Literal[STAGE_APPROVAL_TRIGGERS]
    projectId:      str
    targetStage:    Union[int, Literal["EXCEL"]]
    triggeredAt:    Optional[str] = None
    triggeredBy:    Optional[Literal["SYSTEM", "ESTIMATOR"]] = None
    idempotencyKey: Optional[str] = None

    @field_validator("targetStage")
    @classmethod
    def target_stage_must_be_valid(cls, v: Union[int, str]) -> Union[int, str]:
        if isinstance(v, int) and not (2 <= v <= 6):
            raise ValueError(f"targetStage must be between 2 and 6, got {v}")
        return v


# ─────────────────────────────────────────────────────────────────────────────
# Top-level parse — routes to the correct model based on message shape
# ─────────────────────────────────────────────────────────────────────────────

ExtractionIncomingMessage = Union[Stage0ExtractionMessage, StageApprovedMessage]


def parse_extraction_message(data: Dict[str, Any]) -> ExtractionIncomingMessage:
    """
    Parses a raw Service Bus message body (already json.loads'd) into either
    a Stage0ExtractionMessage or a StageApprovedMessage, based on shape:

      - jobType == "PROJECT_EXTRACTION" or trigger == "BEGIN_EXTRACTION"
            -> Stage0ExtractionMessage
      - trigger in STAGE_APPROVAL_TRIGGERS
            -> StageApprovedMessage
      - anything else -> ValueError

    Raises pydantic.ValidationError or ValueError on bad shape — the worker
    treats both as unrecoverable (dead-letter).
    """
    if not isinstance(data, dict):
        raise ValueError(f"Message body must be a JSON object, got {type(data)}")

    job_type = data.get("jobType")
    trigger  = data.get("trigger")

    if job_type == "PROJECT_EXTRACTION" or trigger == "BEGIN_EXTRACTION":
        return Stage0ExtractionMessage(**data)

    if trigger in STAGE_APPROVAL_TRIGGERS:
        return StageApprovedMessage(**data)

    raise ValueError(
        f"Unrecognized message shape — jobType={job_type!r}, trigger={trigger!r}"
    )