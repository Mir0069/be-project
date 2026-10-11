# GFS Rule Engine Problems and Resolutions Report

## Executive Summary
This document details the issues identified in the GFS Rule Engine (`GFS-AI`), based on [`GFS_Rules_Engine.docx`](file:///C:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/inputs/GFS_Rules_Engine.docx) and the official decision flowchart [`GFS Frame Decision Tree (1).pdf`](file:///C:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/inputs/GFS%20Frame%20Decision%20Tree%20(1).pdf), along with how each issue was resolved.

All fixes were implemented strictly on branch `om/dev-copy`, organized into **4 separate git commits**, and validated using dedicated unit test suites.

---

## Detailed Problems and Resolutions

### Problem 1: Rule 2 Glass Type Decision Synchronization & Fallback Misalignment
- **Affected File**: [`rules/rule2_glass_type.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule2_glass_type.py)
- **Commit Hash**: `dbef0b214c7c48751ecaa15e39616554c263eaa3`
- **Issue**:
  1. `_decide_from_canonical()` and `decide_glass_type()` (text fallback) contained divergent business logic for identical scenarios (e.g., handling of exterior skylights with unknown air gaps, walkable context ambiguity, default values).
  2. Terminology misalignment existed between `GLASS_2_0` (interior floor system) and `GLASS_WITH_IGU` (skylight with IGU).
  3. Ambiguous/missing signals (e.g. unknown walkability context) were implicitly converted into real glass classifications rather than flagging `MANUAL` / `UNKNOWN` for estimator review.
- **Resolution**:
  1. Unified `_decide_from_canonical()` and `decide_glass_type()` to follow identical decision tree logic:
     - Glass-only replacement $\rightarrow$ `GLASS_ONLY` (Proposal 9)
     - Stair treads $\rightarrow$ `STAIR_TREAD` (Proposal 10)
     - EconoFrame explicitly stated $\rightarrow$ `GLASS_NO_IGU` (Proposal 7/8)
     - Non-walkable $\rightarrow$ `NON_WALKABLE`
     - Walkable + Interior + Open Space Below $\rightarrow$ `GLASS_NO_IGU`
     - Walkable + Interior + Wine Cellar Below $\rightarrow$ `GLASS_2_0`
     - Walkable + Exterior + Open Below $\rightarrow$ `GLASS_NO_IGU`
     - Walkable + Exterior + Conditioned Below $\rightarrow$ `GLASS_WITH_IGU`
     - Context / Walkability Unclear $\rightarrow$ `MANUAL` with explicit estimator flags.
  2. Decoupled Glass Type decision logic from Frame Type decision logic.
- **Verification**: [`tests/test_rule2_alignment.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/tests/test_rule2_alignment.py) — 5/5 tests passed (`OK`).

---

### Problem 2: Rule 3 Frame Selection Misaligned with Official Decision Tree Flowchart
- **Affected File**: [`rules/rule3_frame_type.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule3_frame_type.py)
- **Commit Hash**: `5a67235f6a68f446d00aefa1ac95c568f44683b6`
- **Issue**:
  1. Existing frame selection did not mirror the multi-tier branching in `GFS Frame Decision Tree (1).pdf`.
  2. Panel count configuration (Single vs Multi Panel), mounting type (Curb Mounted vs Pedestal vs Recessed), Custom Radius Shape (`Custom Rolled Steel`), and Interior Floor conditioned space/existing support structure branches were not properly handled.
  3. Multi-panel curb-mounted skylights were incorrectly defaulting to Series 3000 instead of Series 2000 Pedestal.
- **Resolution**:
  Refactored `decide_frame_type()` and panel count extraction to enforce the exact flowchart:
  - **GLASS ONLY**: $\rightarrow$ `BLANK` frame (Proposal 9)
  - **SKYLIGHT**:
    - Custom Radius Shape $\rightarrow$ `CUSTOM_ROLLED_STEEL`
    - Walkable & Non-Walkable:
      - **Single Panel + Curb Mounted**: $\rightarrow$ `SERIES_3000`
      - **Single Panel + Pedestal**: $\rightarrow$ `SERIES_2000_PEDESTAL`
      - **Single Panel + Recessed**: $\rightarrow$ `SERIES_2000_RECESSED`
      - **Multi Panel + Curb Mounted**: $\rightarrow$ `SERIES_2000_PEDESTAL`
      - **Multi Panel + Pedestal**: $\rightarrow$ `SERIES_2000_PEDESTAL`
      - **Multi Panel + Recessed**: $\rightarrow$ `SERIES_2000_RECESSED`
  - **INTERIOR FLOOR**:
    - Conditioned space below = **NO** $\rightarrow$ `MODIFIED_SERIES_1000`
    - Conditioned space below = **YES**:
      - Existing support structure = **NO**:
        - Custom Radius = NO $\rightarrow$ `PERIMETER_NTB` (*non-thermally broken interior*)
        - Custom Radius = YES $\rightarrow$ `CUSTOM_ROLLED_STEEL`
      - Existing support structure = **YES**:
        - Custom Radius = NO $\rightarrow$ `ECONOFRAME`
        - Custom Radius = YES $\rightarrow$ `CUSTOM_ROLLED_STEEL`
- **Verification**: [`tests/test_rule3_decision_tree.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/tests/test_rule3_decision_tree.py) — 6/6 tests passed (`OK`).

---

### Problem 3: Rule 4 Rafter Estimation Assuming 1D Layouts Only
- **Affected File**: [`rules/rule4_cross_beam.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule4_cross_beam.py)
- **Commit Hash**: `5c81160a4c331d83144bee4cce201c643709afee`
- **Issue**:
  1. The rafter estimator assumed all multi-panel units were arranged in a single row (`vertical = panel_count - 1, horizontal = 0`). This failed for 2D grid layouts (e.g. 2x2, 3x2), missing horizontal rafters.
  2. EconoFrame cross-beam size 3.5" vs 2.5" needed clear engineering dependency flags.
- **Resolution**:
  1. Replaced `_estimate_rafters` with `_extract_layout_details()` to parse 2D grid dimensions ($R \times C$) and calculate vertical rafters ($C - 1$) and horizontal rafters ($R - 1$) dynamically.
  2. Single-row layout fallback ($P - 1$) attaches an explicit estimator flag asking to confirm if 2D grid applies.
- **Verification**: [`tests/test_rule4_layout.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/tests/test_rule4_layout.py) — 3/3 tests passed (`OK`).

---

### Problem 4: Rule 5 Blackpaint Verification & Rule 6 Calculations Audit
- **Affected Files**: [`rules/rule5_addons.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule5_addons.py), [`rules/rule6_calculations.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule6_calculations.py)
- **Commit Hash**: `ee42275f2919120b4e45a246cb63e76797fbd741`
- **Issue**:
  1. Blackpaint check needed re-verification against GFS client response ("we only back paint if project is expedited with EGR"). Ceramic frit is in base price, not a separate workbook item.
  2. Audit Rule 6 calculation formulas (`sqft`, `perimeter_lf`, `rafter_lf`, `silicone_tubes`, `weight_lbs`) to ensure rafter LF inclusion in silicone tube calculations and glass weight multipliers.
- **Resolution**:
  1. Confirmed `backpaint` triggers strictly for EGR + expedited orders (`backpaint = y`). All non-expedited EGR or non-EGR orders return `backpaint = n`.
  2. Audited Rule 6 unit calculations (`sqft = (W × L) / 144`, `perimeter_lf = 2 × (W + L) / 12`, `silicone_tubes = ceil((perimeter_lf + rafter_lf) / 10)`).
- **Verification**: [`tests/test_rule5_rule6_audit.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/tests/test_rule5_rule6_audit.py) — 3/3 tests passed (`OK`).

---

## Summary of Commits on `om/dev-copy`

| Commit Hash | Topic | Files Modified | Test Suite Result |
|---|---|---|---|
| `dbef0b2` | Rule 2 Alignment | `rules/rule2_glass_type.py`, `tests/test_rule2_alignment.py` | 5/5 PASSED |
| `5a67235` | Rule 3 Decision Tree | `rules/rule3_frame_type.py`, `tests/test_rule3_decision_tree.py` | 6/6 PASSED |
| `5c81160` | Rule 4 Layout Rafters | `rules/rule4_cross_beam.py`, `tests/test_rule4_layout.py` | 3/3 PASSED |
| `ee42275` | Rule 5/6 Audit | `rules/rule5_addons.py`, `rules/rule6_calculations.py`, `tests/test_rule5_rule6_audit.py` | 3/3 PASSED |

**Complete Rule Suite Run**: 20/20 tests passed (`python -m unittest discover -s tests -p "test_rule*.py"`).
