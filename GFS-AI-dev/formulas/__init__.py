"""
formulas
========
Modular mathematical and engineering calculation library for GFS-AI.
Pure Python, deterministic, 0 AI tokens, fully testable.
"""

from formulas.geometry import (
    calculate_sqft,
    calculate_outer_dimensions,
    calculate_perimeter_lf,
    calculate_rafter_lf,
)

from formulas.materials import (
    calculate_glass_weight,
    calculate_silicone_tubes,
)

from formulas.fabrication import (
    MAN_HOURS_BASE,
    calculate_man_hours,
)

from formulas.packaging import (
    calculate_packaging_base,
)

__all__ = [
    "calculate_sqft",
    "calculate_outer_dimensions",
    "calculate_perimeter_lf",
    "calculate_rafter_lf",
    "calculate_glass_weight",
    "calculate_silicone_tubes",
    "MAN_HOURS_BASE",
    "calculate_man_hours",
    "calculate_packaging_base",
]
