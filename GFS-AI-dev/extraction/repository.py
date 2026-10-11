"""
ExtractionRepository — the single interface the rules engine calls.

Rules engine always does:
    repo = get_repository()
    extraction = repo.get(project_id)

It never knows if data came from AI or MongoDB.
New sources in future (ZOHO, Teams transcript, etc.) just add a new
implementation — rules engine code changes zero lines.
"""

import json
from abc import ABC, abstractmethod
from typing import Optional

from .models import (
    ExtractionResult, DocumentRead, Person, Address,
    Measurement, ExplicitStatement, Conflict, Flag
)


# ─────────────────────────────────────────────
# ABSTRACT BASE — this is what rules engine sees
# ─────────────────────────────────────────────

class ExtractionRepository(ABC):

    @abstractmethod
    def get(self, project_id: str) -> Optional[ExtractionResult]:
        """
        Get extraction result for a project.
        Returns None if not found.
        """
        ...

    @abstractmethod
    def save(self, result: ExtractionResult) -> None:
        """
        Persist extraction result.
        """
        ...


# ─────────────────────────────────────────────
# PARSER — shared by both implementations
# Converts raw dict (from JSON or MongoDB) → ExtractionResult
# ─────────────────────────────────────────────

def _parse(data: dict) -> ExtractionResult:
    """
    Convert a raw dict to ExtractionResult.
    Works for both AI JSON response and MongoDB document.
    MongoDB adds _id, created_at etc — these are simply ignored.
    """

    def _doc(d: dict) -> DocumentRead:
        return DocumentRead(
            file=d.get("file", ""),
            path=d.get("path"),
            type=d.get("type"),
            pages=d.get("pages"),
            date=d.get("date"),
            revision=d.get("revision"),
            status=d.get("status"),
            relevant=d.get("relevant", True),
            irrelevant_reason=d.get("irrelevant_reason"),
        )

    def _person(d: dict) -> Person:
        return Person(
            name=d.get("name", ""),
            email=d.get("email"),
            phone=d.get("phone"),
            company=d.get("company"),
            role_as_stated=d.get("role_as_stated"),
            appears_to_be=d.get("appears_to_be"),
            source=d.get("source"),
        )

    def _address(d: dict) -> Address:
        return Address(
            value=d.get("value", ""),
            context=d.get("context"),
            source=d.get("source"),
        )

    def _measurement(d: dict) -> Measurement:
        return Measurement(
            raw=d.get("raw", ""),
            dim_1_raw=d.get("dim_1_raw"),
            dim_1_parsed_inches=d.get("dim_1_parsed_inches"),
            dim_1_axis=d.get("dim_1_axis"),
            dim_2_raw=d.get("dim_2_raw"),
            dim_2_parsed_inches=d.get("dim_2_parsed_inches"),
            dim_2_axis=d.get("dim_2_axis"),
            dim_3_raw=d.get("dim_3_raw"),
            dim_3_parsed_inches=d.get("dim_3_parsed_inches"),
            dim_3_axis=d.get("dim_3_axis"),
            unit_as_written=d.get("unit_as_written"),
            label_as_written=d.get("label_as_written"),
            shape=d.get("shape"),
            panel_count=d.get("panel_count"),
            rafter_count=d.get("rafter_count"),
            rows=d.get("rows"),
            columns=d.get("columns"),
            vertical_rafter_count=d.get("vertical_rafter_count"),
            horizontal_rafter_count=d.get("horizontal_rafter_count"),
            t_rafter_details=d.get("t_rafter_details"),
            layout_source=d.get("layout_source"),
            context=d.get("context"),
            location_context=d.get("location_context"),
            source_file=d.get("source_file"),
            source_page=d.get("source_page"),
            said_by=d.get("said_by"),
            times_repeated=d.get("times_repeated", 1),
            confidence=d.get("confidence"),
        )

    def _statement(d: dict) -> ExplicitStatement:
        return ExplicitStatement(
            verbatim=d.get("verbatim", ""),
            context=d.get("context"),
            source_file=d.get("source_file"),
            source_page=d.get("source_page"),
            said_by=d.get("said_by"),
            statement_type=d.get("statement_type"),
        )

    def _conflict(d: dict) -> Conflict:
        return Conflict(
            description=d.get("description", ""),
            values=d.get("values", []),
        )

    def _flag(d: dict) -> Flag:
        return Flag(
            description=d.get("description", ""),
            source=d.get("source"),
        )

    return ExtractionResult(
        project_id=data.get("project_id", ""),
        extraction_status=data.get("extraction_status", "PARTIAL"),
        no_input_reason=data.get("no_input_reason"),
        overall_confidence=data.get("overall_confidence"),
        quote_mode_hint=data.get("quote_mode_hint"),
        documents_read=[_doc(d) for d in data.get("documents_read", [])],
        people=[_person(d) for d in data.get("people", [])],
        addresses=[_address(d) for d in data.get("addresses", [])],
        measurements=[_measurement(d) for d in data.get("measurements", [])],
        explicit_statements=[_statement(d) for d in data.get("explicit_statements", [])],
        references_to_other_jobs=data.get("references_to_other_jobs", []),
        conflicts=[_conflict(d) for d in data.get("conflicts", [])],
        flags=[_flag(d) for d in data.get("flags", [])],
    )


# ─────────────────────────────────────────────
# IMPLEMENTATION 1 — AI JSON (current)
# Pass in the raw JSON string from the AI call.
# ─────────────────────────────────────────────

class AIResponseRepository(ExtractionRepository):
    """
    In-memory repository backed by a raw AI JSON response.
    Used right after the AI extraction call.
    """

    def __init__(self, ai_json: str):
        data = json.loads(ai_json)
        self._result = _parse(data)

    def get(self, project_id: str) -> Optional[ExtractionResult]:
        if self._result.project_id == project_id:
            return self._result
        return None

    def save(self, result: ExtractionResult) -> None:
        # Not needed for in-memory — used only for reading AI response
        self._result = result


# ─────────────────────────────────────────────
# IMPLEMENTATION 2 — MongoDB (future)
# Drop-in replacement. Rules engine changes zero lines.
# ─────────────────────────────────────────────

class MongoExtractionRepository(ExtractionRepository):
    """
    MongoDB-backed repository.
    Swap this in when the pipeline moves to persistent storage.
    Rules engine code stays identical.
    """

    def __init__(self, mongo_collection):
        """
        mongo_collection: a pymongo Collection object.
        Injected from outside — this file never imports pymongo directly.
        """
        self._col = mongo_collection

    def get(self, project_id: str) -> Optional[ExtractionResult]:
        doc = self._col.find_one({"project_id": project_id})
        if doc is None:
            return None
        # MongoDB adds _id — _parse ignores unknown fields automatically
        return _parse(doc)

    def save(self, result: ExtractionResult) -> None:
        import dataclasses
        data = dataclasses.asdict(result)
        self._col.update_one(
            {"project_id": result.project_id},
            {"$set": data},
            upsert=True,
        )


# ─────────────────────────────────────────────
# FACTORY — single entry point
# Rules engine calls this, never instantiates directly.
# ─────────────────────────────────────────────

def get_repository(
    source: str = "ai",
    ai_json: str = None,
    mongo_collection=None,
) -> ExtractionRepository:
    """
    source="ai"    → AIResponseRepository (current default)
    source="mongo" → MongoExtractionRepository (future)

    Example — current usage:
        repo = get_repository(source="ai", ai_json=raw_response)
        extraction = repo.get(project_id)

    Example — future MongoDB usage (zero rules engine changes):
        repo = get_repository(source="mongo", mongo_collection=col)
        extraction = repo.get(project_id)
    """
    if source == "ai":
        if ai_json is None:
            raise ValueError("ai_json required when source='ai'")
        return AIResponseRepository(ai_json)

    if source == "mongo":
        if mongo_collection is None:
            raise ValueError("mongo_collection required when source='mongo'")
        return MongoExtractionRepository(mongo_collection)

    raise ValueError(f"Unknown source: {source}. Use 'ai' or 'mongo'.")