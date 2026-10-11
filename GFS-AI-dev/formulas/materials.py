"""
formulas/materials.py
=====================
Physical and consumable material calculations (weight and silicone sealant).
"""
import math


def calculate_glass_weight(sqft: float, lbs_per_sqft: float = 15.0) -> float:
    """
    Weight of structural glass in pounds.
    Default baseline is 15.0 lbs/sqft for 3-ply walkable structural glass.
    """
    return sqft * lbs_per_sqft


def calculate_silicone_tubes(
    perimeter_lf: float,
    rafter_lf: float = 0.0,
    lf_per_tube: float = 10.0
) -> int:
    """
    Number of silicone sealant tubes needed to seal perimeter + rafter joints.
    Always rounds UP to the nearest full tube (confirmed by GFS client rules).
    Formula: ceil((perimeter_lf + rafter_lf) / lf_per_tube)
    """
    total_lf = perimeter_lf + rafter_lf
    return math.ceil(total_lf / lf_per_tube)
