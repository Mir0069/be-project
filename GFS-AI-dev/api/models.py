from pydantic import BaseModel
from typing import Optional, Any, Union, Literal

VALID_TRIGGERS = Literal[
    "BEGIN_EXTRACTION",
    "REVISION",
    "STAGE_1_APPROVED_START_2",
    "STAGE_2_APPROVED_START_3",
    "STAGE_3_APPROVED_START_4",
    "STAGE_4_APPROVED_START_5",
    "STAGE_5_APPROVED_START_6",
]

class DocumentEntry(BaseModel):
    documentId: str
    originalName: str
    blobUrl: str

class TriggerMessage(BaseModel):
    message_id: str
    project_id: str
    trigger: VALID_TRIGGERS
    subject: Optional[str] = None
    sender: Optional[str] = None
    context: Optional[Union[str, dict, list, Any]] = None
    documents: Optional[list[DocumentEntry]] = None
    unified_doc: Optional[dict] = None
    sent_at: Optional[str] = None

class StageRequest(BaseModel):
    project_id: str
    unified_doc: dict

class PipelineResponse(BaseModel):
    message_id: Optional[str] = None
    project_id: str
    in_response_to: Optional[str] = None
    trigger: Optional[VALID_TRIGGERS] = None
    status: str  # COMPLETE | FAILED | NO_DOCUMENTS | PARTIAL
    output: Optional[dict] = None
    error: Optional[str] = None
    completed_at: str
