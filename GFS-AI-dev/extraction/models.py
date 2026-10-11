"""
ExtractionResult — the single model the rules engine always works with.
Source doesn't matter: AI response, MongoDB, or future sources.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Person:
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None
    role_as_stated: Optional[str] = None
    appears_to_be: Optional[str] = None  # sender | recipient | referenced_party
    source: Optional[str] = None


@dataclass
class Address:
    value: str
    context: Optional[str] = None
    source: Optional[str] = None


@dataclass
class Measurement:
    raw: str
    dim_1_raw: Optional[str] = None
    dim_1_parsed_inches: Optional[float] = None
    dim_1_axis: Optional[str] = None
    dim_2_raw: Optional[str] = None
    dim_2_parsed_inches: Optional[float] = None
    dim_2_axis: Optional[str] = None
    dim_3_raw: Optional[str] = None
    dim_3_parsed_inches: Optional[float] = None
    dim_3_axis: Optional[str] = None
    unit_as_written: Optional[str] = None
    label_as_written: Optional[str] = None
    shape: Optional[str] = None
    panel_count: Optional[int] = None
    rafter_count: Optional[int] = None
    rows: Optional[int] = None
    columns: Optional[int] = None
    vertical_rafter_count: Optional[int] = None
    horizontal_rafter_count: Optional[int] = None
    t_rafter_details: Optional[str] = None
    layout_source: Optional[str] = None
    context: Optional[str] = None
    location_context: Optional[str] = None
    source_file: Optional[str] = None
    source_page: Optional[int] = None
    said_by: Optional[str] = None
    times_repeated: int = 1
    confidence: Optional[str] = None


@dataclass
class ExplicitStatement:
    verbatim: str
    context: Optional[str] = None
    source_file: Optional[str] = None
    source_page: Optional[int] = None
    said_by: Optional[str] = None
    statement_type: Optional[str] = None  # request|preference|constraint|question|reference|other


@dataclass
class Conflict:
    description: str
    values: list = field(default_factory=list)


@dataclass
class Flag:
    description: str
    source: Optional[str] = None


@dataclass
class DocumentRead:
    file: str
    path: Optional[str] = None
    type: Optional[str] = None
    pages: Optional[int] = None
    date: Optional[str] = None
    revision: Optional[str] = None
    status: Optional[str] = None
    relevant: bool = True
    irrelevant_reason: Optional[str] = None


@dataclass
class ExtractionResult:
    """
    The single model the rules engine always works with.
    Populated from AI JSON or MongoDB — rules engine never knows which.
    """
    project_id: str
    extraction_status: str                          # COMPLETE | PARTIAL | NO_CUSTOMER_INPUT
    no_input_reason: Optional[str] = None
    overall_confidence: Optional[str] = None
    quote_mode_hint: Optional[str] = None

    documents_read: list[DocumentRead] = field(default_factory=list)
    people: list[Person] = field(default_factory=list)
    addresses: list[Address] = field(default_factory=list)
    measurements: list[Measurement] = field(default_factory=list)
    explicit_statements: list[ExplicitStatement] = field(default_factory=list)
    references_to_other_jobs: list[dict] = field(default_factory=list)
    conflicts: list[Conflict] = field(default_factory=list)
    flags: list[Flag] = field(default_factory=list)