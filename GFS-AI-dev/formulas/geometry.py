"""
formulas/geometry.py
====================
Pure geometric calculations for GFS units, glass panels, and outer openings.
"""

def calculate_sqft(width_inches: float, length_inches: float) -> float:
    """
    Total square footage for a unit.
    Formula: (width_in * length_in) / 144
    panel_count is NOT a multiplier here — width/length are already the
    full opening dimensions for this unit (confirmed against FormulaEngineService,
    the backend source of truth: panelSqft = (width_in * length_in) / 144).
    """
    return (width_inches * length_inches) / 144.0


def calculate_outer_dimensions(
    width_inches: float,
    length_inches: float,
    panel_count: int
) -> tuple[float, float]:
    """
    Outer opening dimensions assuming panels are arranged in a row along the width dimension.
    Returns: (outer_width_inches, outer_length_inches)
    """
    outer_width = panel_count * width_inches
    outer_length = length_inches
    return outer_width, outer_length


def calculate_perimeter_lf(width_inches: float, length_inches: float) -> float:
    """
    Outer perimeter in Linear Feet (LF) for a unit opening.
    Formula: 2 * (width_in + length_in) / 12
    Width and length represent the full unit opening dimensions.
    """
    return 2.0 * (width_inches + length_inches) / 12.0


def calculate_rafter_lf(
    vertical_rafters: int,
    width_inches: float,
    horizontal_rafters: int = 0,
    length_inches: float = 0.0
) -> float:
    """
    Total rafter linear feet across vertical and horizontal joints.
    Vertical rafters run across the width dimension; horizontal rafters run
    across the length dimension. Width/length are the unit's full opening
    dimensions (not per-panel, not panel-count-scaled).
    Formula: (vertical_rafters * width_in + horizontal_rafters * length_in) / 12
    Confirmed against the GFS Master Workbook take-off formula
    (Total length = (K*E)+(L*F), where E=Width, F=Length, K=Vertical, L=Horizontal —
    verified identical across Friendly Hall, Clinton St, Somerville Dr, 6 Juneau Way).
    """
    v_rafter_lf = vertical_rafters * width_inches / 12.0
    h_rafter_lf = horizontal_rafters * length_inches / 12.0
    return v_rafter_lf + h_rafter_lf
