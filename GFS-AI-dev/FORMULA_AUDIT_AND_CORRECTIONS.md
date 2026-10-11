# Forensic Engineering Audit: GFS Formula Discrepancies & Proposed Corrections

This document outlines the **4 mathematical and engineering discrepancies** identified across the `GFS-AI` and `GFS-backend` calculation engines, why they are currently flawed, and the proposed industry-standard corrections.

---

## 1. The Glass Weight Calculation (Major Safety & Freight Underestimate)

### What the code currently does:
* **`GFS-AI`:** Uses a flat `15.0 lbs/sqft` for every glass type.
* **`GFS-backend`:** Uses `3.2 lbs/sqft` (`GLASS_NO_IGU`) and `6.4 lbs/sqft` (`GLASS_WITH_IGU`).

### Why this is wrong:
* **Backend Flaw:** `3.2 lbs/sqft` is the weight of standard **1/4" thin window glass**. GFS builds **3-ply laminated structural walk-on glass** (three layers of 3/8" or 1/2" glass bonded with SentryGlas interlayers). A 100 sqft glass floor actually weighs **~1,500 lbs**, but the backend calculates it as **320 lbs**! This causes freight shipping, crating, and crane calculations to be dangerously underquoted.
* **AI Flaw:** A monolithic walk-on floor (`GLASS_NO_IGU`, ~1" thick) weighs ~13.5 lbs/sqft, whereas an insulated walkable skylight with an air gap (`GLASS_WITH_IGU`, ~2.25" total makeup) weighs ~19.5 lbs/sqft, and heavy stair treads weigh ~21 lbs/sqft.

### The Correct Formula:
```python
# Dynamic weight based on glass structural makeup:
WEIGHT_MAP = {
    "GLASS_NO_IGU":   13.5,  # 3-ply monolithic walkable laminate
    "GLASS_WITH_IGU": 19.5,  # Insulated walk-on IGU (top walk lite + gap + bottom lite)
    "STAIR_TREAD":    21.0,  # 3-ply heavy traffic structural glass
    "NON_WALKABLE":    7.5,  # Standard non-walkable skylight
}
weight_lbs = total_sqft * WEIGHT_MAP.get(glass_type, 15.0)
```

---

## 2. Silicone Sealant Tubes Calculation (Joint Volume & Rafter Omission)

### What the code currently does:
* **`GFS-AI`:** `ceil((perimeter_lf + rafter_lf) / 8)`
* **`GFS-backend`:** `ceil(perimeter_lf / 10)` (completely ignores `rafter_lf`).

### Why this is wrong:
* **Backend Flaw:** In a multi-panel unit (like Jane St with 14 panels), the inner silicone joints between panels add **65 LF of rafters**. The backend completely ignores rafters, causing the estimator to under-order silicone by **over 50%**.
* **AI Flaw:** Internal rafter joints have structural silicone applied on **both sides** of the glass panel edge. A flat addition `perimeter_lf + rafter_lf` slightly undercounts the internal silicone volume for deep curb channels.

### The Correct Formula:
```python
# Outer perimeter has 1 joint line; internal rafters join 2 panel edges:
total_sealing_lf = outer_perimeter_lf + (2 * rafter_lf)
silicone_tubes = math.ceil(total_sealing_lf / 8.0)
```

---

## 3. Outer Perimeter on Multi-Panel 2D Grids (1D Row Assumption)

### What the code currently does in `formulas/geometry.py`:
```python
outer_width = panel_count * width_inches
outer_length = length_inches
perimeter_lf = 2 * (outer_width + outer_length) / 12
```

### Why this is wrong:
* It assumes panels are always laid out in a **single 1D straight line** (e.g. $1 \times 6$ panels).
* If a skylight is a **$2 \times 3$ grid** (2 rows of 3 panels):
  * **Real Outer Dimensions:** $(3 \times \text{width}) \times (2 \times \text{length})$.
  * **Current Formula computes:** $(6 \times \text{width}) \times (1 \times \text{length})$.
* This artificially stretches the perimeter and distorts the outer frame extrusion cost for square or rectangular grids.

### The Correct Formula:
```python
def calculate_outer_perimeter(width_in, length_in, grid_rows=1, grid_cols=1):
    outer_w = grid_cols * width_in
    outer_l = grid_rows * length_in
    return 2.0 * (outer_w + outer_l) / 12.0
```

---

## 4. Heat Soak Testing (HST) Trigger Logic

### What the code currently does:
* Triggers if total aggregate project weight $> 600\text{ lbs}$.

### Why this is wrong:
* Heat Soak Testing in architectural engineering is required to prevent spontaneous breakage in **heavy individual glass lites**, not aggregate total project weight.
* A project with ten small 50-lb panels (total 500 lbs) does **not** need HST.
* A project with one massive 500-lb single glass panel **definitely requires HST**.

### The Correct Rule:
* Trigger HST if **`max_single_panel_weight > 150 lbs`** OR if the customer architectural notes explicitly require ASTM C1048 heat soaking.

---

## 🎯 Summary Comparison Table

| Formula | Current Implementation | Real Engineering Truth | Risk / Impact |
| :--- | :--- | :--- | :--- |
| **Glass Weight** | Backend uses 3.2–6.4 lbs; AI uses flat 15.0 lbs | 13.5 lbs (monolithic) to 19.5 lbs (IGU) | Crane/freight underquoted by 50–70% in backend. |
| **Silicone Tubes** | Backend ignores rafters; AI adds $1\times$ rafters | Perimeter $+ (2\times \text{rafters})$ | Installers run out of sealant on job site. |
| **Perimeter LF** | Assumes 1D strip only ($1\times N$) | $R \times C$ 2D grid dimensions | Overquotes frame metal on rectangular clusters. |
| **Heat Soak Testing** | Aggregate job weight $> 600$ lbs | Single panel weight $> 150$ lbs | False positives on small multi-panel decks. |
