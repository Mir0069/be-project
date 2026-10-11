# Rule Engine Bug Analysis and Resolution Report

## Overview
This document provides a comprehensive summary of the audit, identified issues, and code resolutions implemented in the GFS Rule Engine (`GFS-AI`) and related parameter calculation logic in `GFS-backend`.

All fixes have been applied strictly to the `om/dev-copy` branch without modifying shared global resources (e.g., MongoDB schemas/data).

---

## Identified Issues and Fixes

### 1. Silicone Tube Estimation Missing Rafter Seams (`GFS-AI`)
- **File**: [`rules/rule6_calculations.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule6_calculations.py)
- **Problem**: 
  In `_calc_unit()` and `compute_calculations()`, `calculate_silicone_tubes()` was being called with `rafter_lf=0.0`. This omitted the internal rafter seam linear footage when estimating required silicone sealant tubes for multi-panel glass units, leading to underestimation of silicone sealant materials.
- **Resolution**:
  - In `_calc_unit()`: Updated the call to pass `rafter_lf=rafter_lf` so individual unit silicone tube calculations include rafter linear footage.
  - In `compute_calculations()`: Updated aggregate silicone tube calculation to pass `rafter_lf=result.total_rafter_lf`.
- **Affected Lines**:
  - `_calc_unit()`: [rule6_calculations.py L195](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule6_calculations.py#L195)
  - `compute_calculations()`: [rule6_calculations.py L357](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule6_calculations.py#L357)

---

### 2. Glass Type Object / Dictionary Unwrapping Failure (`GFS-AI`)
- **File**: [`rules/rule6_calculations.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule6_calculations.py)
- **Problem**:
  `_calc_unit()` received `glass_type_code` which in some upstream pipelines is passed as a `GlassTypeResult` dataclass object or a dictionary (e.g., `{"glass_type_code": "GLASS_WITH_IGU"}`) rather than a raw string. Direct invocation of `.upper()` on a non-string object caused `AttributeError` or unexpected weight calculation fallbacks.
- **Resolution**:
  Added safe object unwrapping prior to string normalization:
  ```python
  gt_val = glass_type_code
  if hasattr(gt_val, "glass_type_code"):
      gt_val = getattr(gt_val, "glass_type_code", None)
  elif isinstance(gt_val, dict):
      gt_val = gt_val.get("glass_type_code")

  gt = (str(gt_val or unit.glass_type or "")).upper().strip()
  ```
- **Affected Lines**:
  - [rule6_calculations.py L178-L184](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule6_calculations.py#L178-L184)

---

### 3. Crossbeam & Rafter Linear Feet Formula Verification (`GFS-backend`)
- **File**: `GFS-backend/src/features/proposal/final-parameters.calculator.ts`
- **Audit Findings**:
  Investigated the formula for `crossbeamLengthIn`:
  `verticalRafters * widthIn + horizontalRafters * lengthIn`
  - In the Atkinson framing model, `widthIn` represents panel span width across vertical rafters, and `lengthIn` represents total length along horizontal rafters.
  - Verified against Jest tests (`final-parameters.calculator.test.ts`), confirming that the current formula accurately satisfies existing system contracts.

---

## Verification & Automated Tests

A dedicated test suite was created in `GFS-AI` to verify the resolutions:
- **Test File**: [`tests/test_rule6_fixes.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/tests/test_rule6_fixes.py)
- **Test Cases**:
  1. `test_silicone_tubes_includes_rafter_lf`: Verifies silicone tubes increase proportionally when `rafter_lf` is present.
  2. `test_calc_unit_with_glass_type_object`: Verifies safe unwrapping when `glass_type_code` is passed as a dataclass object.
  3. `test_calc_unit_with_glass_type_dict`: Verifies safe unwrapping when `glass_type_code` is passed as a `dict`.
- **Result**: `3 passed in 0.000s (OK)`

---

## Summary of Modified Files
1. [`GFS-AI/rules/rule6_calculations.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/rules/rule6_calculations.py) - Added rafter LF to silicone tube calculations and implemented safe glass type unwrapping.
2. [`GFS-AI/tests/test_rule6_fixes.py`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/tests/test_rule6_fixes.py) - Added unit test coverage for the fixes.
3. [`GFS-AI/RULE_ENGINE_BUG_FIXES.md`](file:///c:/Users/swapn/Coding%20by%20rak/Amberflux/GFS/GFS-AI/RULE_ENGINE_BUG_FIXES.md) - Documentation detailing bug identification and resolutions.
