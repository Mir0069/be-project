"""
API Schemas — Pydantic v2 Models
Defines the exact JSON structure returned to the frontend for all GFS-AI extraction responses.
Owner: Jignesh
"""

from pydantic import BaseModel
from typing import Optional
from __future__ import annotations
from enum import Enum
from pydantic import Field

class ProposalType(str, Enum):
    S1000_PEDESTAL_FA     = "Series 1000 Pedestal FA"
    S1000_PEDESTAL_KD     = "Series 1000 Pedestal KD"
    S1000_RECESSED_FA     = "Series 1000 Recessed FA"
    # ...rest of enum values

class ProposalUnit(BaseModel):
    unit_id:     str
    location:    Optional[str] = None
    width:       Optional[str] = None
    length:      Optional[str] = None
    num_units:   int = 1

class ProposalSchema(BaseModel):
    project_name:    Optional[str] = None
    project_address: Optional[str] = None
    contact_name:    Optional[str] = None
    units: dict[str, ProposalUnit] = Field(default_factory=dict)


class ProjectHeader(BaseModel):
    project_address: Optional[str] = None
    contractor: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    drawing_date: Optional[str] = None
    quote_number: Optional[str] = None
    revision: Optional[str] = None
    quoted_by: Optional[str] = None


class GlassSpecification(BaseModel):
    glass_makeup: Optional[str] = None
    glass_type: Optional[str] = None
    top_layer_texture: Optional[str] = None
    back_paint: bool = False
    hst: bool = False
    expedited: bool = False
    krypton_gas: bool = False


class Frame(BaseModel):
    series: Optional[str] = None
    frame_type: Optional[str] = None
    frame_material: Optional[str] = None
    finish: Optional[str] = None


class UnitResult(BaseModel):
    unit_id: str
    location: Optional[str] = None
    drawing_number: Optional[str] = None
    width: Optional[str] = None
    length: Optional[str] = None
    quantity: int = 1
    panels: int = 1
    vertical_rafters: int = 0
    horizontal_rafters: int = 0
    computed_sqft: Optional[float] = None
    computed_perimeter_ft: Optional[float] = None
    computed_weight_lbs: Optional[float] = None
    computed_silicone_tubes: Optional[float] = None


class AddOns(BaseModel):
    nanodot: bool = False
    seeded_organic: bool = False
    back_paint: bool = False
    hst: bool = False
    custom_shape_surcharge: bool = False
    titanium_embeds: bool = False
    krypton_gas: bool = False
    colored_interlayer: bool = False
    sentry_glass: Optional[bool] = None
    duty: Optional[float] = None


class ChangeOrder(BaseModel):
    co_number: str
    date: str
    description: str
    amount_added: float
    original_contract: float
    revised_contract: float


class ExtractionMeta(BaseModel):
    total_pages_processed: int
    scanned_pages: int
    vision_fallback_used: bool
    files_processed: list[str]
    source_type: str


class ExtractionResult(BaseModel):
    project_header: Optional[ProjectHeader] = None
    glass_specification: Optional[GlassSpecification] = None
    frame: Optional[Frame] = None
    series: str = "UNKNOWN"
    glass_type: Optional[str] = None
    egr: bool = False
    cross_beam: Optional[str] = None
    units: list[UnitResult] = []
    add_ons: Optional[AddOns] = None
    change_orders: list[ChangeOrder] = []
    confidence: str = "LOW"
    extraction_method: str = "text"
    flags: list[str] = []
    meta: Optional[ExtractionMeta] = None
