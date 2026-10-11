# listener/message_schema.py
# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schema for the incoming Azure Service Bus message.
#
# This schema mirrors ProcessPayloadRequest in fastapi_app.py exactly.
# If the fastapi_app.py models change, update this file to match.
# ─────────────────────────────────────────────────────────────────────────────
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, field_validator, model_validator
from pathlib import Path


class DocumentEntry(BaseModel):
    """A single document inside an EMAIL_PROPOSAL payload."""
    documentId:   str
    originalName: str
    blobUrl:      str

    @field_validator("blobUrl")
    @classmethod
    def blob_url_must_start_with_http(cls, v: str) -> str:
        if not v.startswith("http"):
            raise ValueError(f"blobUrl must start with http(s): {v!r}")
        return v

    @field_validator("originalName")
    @classmethod
    def original_name_must_have_extension(cls, v: str) -> str:
        if not Path(v).suffix:
            raise ValueError(f"originalName has no file extension: {v!r}")
        return v


class EmailProposalPayload(BaseModel):
    """The 'payload' sub-object for EMAIL_PROPOSAL messages."""
    subject:      Optional[str] = None
    sender:       Optional[str] = None
    fromName:     Optional[str] = None
    toRecipients: Optional[List[str]] = None
    ccRecipients: Optional[List[str]] = None
    bccRecipients: Optional[List[str]] = None
    bodyText:         Optional[str] = None
    bodyHtml:         Optional[str] = None
    receivedDateTime: Optional[str] = None
    documents:        List[DocumentEntry] = []
    bidders:          Optional[List[Dict[str, Any]]] = None
    isMultiBidder:    bool = False


class DocumentExtractionPayload(BaseModel):
    """The 'payload' sub-object for DOCUMENT_EXTRACTION messages."""
    projectId:  str
    documentId: str
    blobUrl:    str

    @field_validator("blobUrl")
    @classmethod
    def blob_url_must_start_with_http(cls, v: str) -> str:
        if not v.startswith("http"):
            raise ValueError(f"blobUrl must start with http(s): {v!r}")
        return v

    @property
    def documents(self) -> List[DocumentEntry]:
        from urllib.parse import urlparse
        path = urlparse(self.blobUrl).path
        original_name = path.rsplit("/", 1)[-1] or f"{self.documentId}.bin"
        return [DocumentEntry(
            documentId=self.documentId,
            originalName=original_name,
            blobUrl=self.blobUrl,
        )]


class IncomingMessage(BaseModel):
    """
    Full Service Bus message shape. Supports EMAIL_PROPOSAL, DOCUMENT_EXTRACTION,
    and legacy flat format mappings.
    """
    jobType:       str
    correlationId: str
    payload:       Union[EmailProposalPayload, DocumentExtractionPayload]

    @model_validator(mode="before")
    @classmethod
    def preprocess_legacy_flat_format(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Check if it has snake_case root keys
            if "document_id" in data and "blob_url" in data:
                doc_id = data.get("document_id")
                proj_id = data.get("project_id") or "unknown"
                blob_url = data.get("blob_url")
                
                normalized = {
                    "jobType": "DOCUMENT_EXTRACTION",
                    "correlationId": f"doc:{doc_id}",
                    "payload": {
                        "projectId": proj_id,
                        "documentId": doc_id,
                        "blobUrl": blob_url
                    }
                }
                return normalized
        return data

    @field_validator("payload", mode="before")
    @classmethod
    def route_payload_by_job_type(cls, v, info):
        job_type = info.data.get("jobType")
        if job_type == "DOCUMENT_EXTRACTION":
            return DocumentExtractionPayload(**v) if isinstance(v, dict) else v
        elif job_type == "EMAIL_PROPOSAL":
            return EmailProposalPayload(**v) if isinstance(v, dict) else v
        return v
