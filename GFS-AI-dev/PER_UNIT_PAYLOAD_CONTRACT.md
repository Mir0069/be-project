# GFS-AI → Backend Payload Contract: Per-Unit Glass/Frame/Man-Hours

**Audience:** Backend team implementing storage/API support for this payload.
**Why this doc exists:** GFS-AI now computes glass type, frame type, and man-hours
independently *per unit* instead of one decision for the whole project. This
document is the exact contract of what GFS-AI sends at each stage so the
backend can store and serve it correctly. GFS-AI does not write to MongoDB —
it reads the current document, computes one stage's worth of values, and
sends that stage back as a payload for the backend to persist.

---

## 1. Architecture: staged payloads, not a full resend

Each pipeline stage returns **only its own slice** of the document, never the
whole thing:

| Stage | Function | Returns |
|---|---|---|
| 0 (full extraction) | `new_app/new_ai_engine.py` → `write_rules_to_unified_doc()` | Full document (first-time creation only) |
| 1 | `run_stage_1()` | `{"stage_1": {...}}` |
| 2 | `run_stage_2()` | `{"stage_2": {...}, "units": {...}}` |
| 3 | `run_stage_3()` | `{"stage_3": {...}, "units": {...}}` |
| 4 | `run_stage_4()` | `{"stage_4": {...}}` |
| 5 | `run_stage_5()` | `{"stage_5": {...}, "stage_4": {...}, "units": {...}}` (returns `stage_5` calculations/addons, `stage_4` takeoff packaging, and per-unit calculated values in `units`) |
| Revision (any time) | `run_revision()` | Same per-stage shape, only for the field(s) the customer changed |

`units` is included in stage 2/3/5 responses because those stages write
per-unit values (see below) — backend should merge `units` by `unit_id` key,
not replace the whole `units` map.

---

## 2. Unit object schema

Each unit lives at `doc.units.<unit_id>` where `unit_id` is a single letter
`A`–`J`. Full field list (`_empty_unit()` in `config/unified_schema.py`):

```
unit_id                 string   "A".."J"
status                  string   PENDING | NEEDS_REVIEW | APPROVED | CANCELLED
extracted_width_in      number|null   read-only, AI extraction audit trail
extracted_length_in     number|null
extracted_diameter_in   number|null
extracted_panel_count   number|null
extracted_rafter_count  number|null
extracted_verbatim      string|null
extracted_citation      object|null
extracted_at            ISO8601 string|null
extracted_confidence    string|null   (HIGH|MEDIUM|LOW)
extracted_location      string|null
extracted_dim_type      string|null
extracted_drawing_no    string|null
extracted_frame_type    string|null
extracted_glass_type    string|null
extracted_glass_thickness string|null
value_width_in          number|null   current working value — estimator can overwrite
value_length_in         number|null
value_diameter_in       number|null
value_panel_count       number|null
value_rafter_count      number|null
value_num_units         number   default 1
value_location          string|null
value_drawing_no        string|null
value_drawing_number    string|null
value_frame_type        string|null   enum, see §4
value_glass_type        string|null   enum, see §4
value_glass_thickness   string|null
value_description       string|null
generated_desc_at       ISO8601 string|null
description_manually_edited boolean
reasoning               string[]
flags                   string[]
updated_at              ISO8601 string|null
updated_by              string|null   "extraction" | "rules_engine" | "rules_engine_per_unit" | "estimator" | ...
excel_takeoff_row       number   (internal, for Excel writer — backend can ignore)
excel_*_cell            string   (internal, for Excel writer — backend can ignore)
```

### 2a. NEW fields — need backend schema support

These are not yet declared in the canonical schema on the AI side either
(`_empty_unit()` doesn't define them yet — flagged here so both sides add
them together). They may already exist informally; confirm before assuming.

| Field | Type | Meaning | Written by |
|---|---|---|---|
| `unit_label` | `string \| null` | The AI's own internal descriptive label for this unit (e.g. `"Skylight assembly 1"`, `"WS-1 Walkable Skylight (North Bay)"`). Used only to match a unit across pipeline stages/re-extractions — **not** meant for display; `value_location` / `value_description` are the estimator-facing labels. | `extraction/schema_builder.py` at unit creation |
| `value_rows` | `number \| null` | Row count of the panel grid, when a 2D layout is known/stated (e.g. customer says "3x3"). | AI extraction, or revision patcher on "3x3"-style customer input |
| `value_cols` | `number \| null` | Column count of the panel grid. `value_panel_count` should equal `value_rows × value_cols` whenever both are set. | Same as above |
| `value_is_grid_confirmed` | `boolean \| null` | `true` when rows×cols is a confirmed real 2D layout (not a guessed single-row fallback). Feeds the cross-beam rafter calculation (Rule 4) — without it, the system assumes a single row and can under-count horizontal rafters. | AI extraction, or revision patcher |

### 2b. Stage-5 per-unit calculated fields (already existing, listed for completeness)

Written by `run_stage_5()` after Stage 4 is approved:

```
value_man_hours           number|null   fabrication labor hours for this unit
value_calculated_sqft     number
value_outer_width_in      number
value_outer_length_in     number
value_perimeter_lf        number
value_rafter_lf           number
value_calculated_weight_lbs number
value_silicone_tubes      number
```

---

## 3. Per-unit differentiation — what changed

**Before:** every unit in a project was stamped with one project-level glass
type and frame type, even when units genuinely differ (e.g. a walkable
pedestal deck vs. a curb-mounted roof skylight in the same job).

**Now:** each unit's own `value_glass_type` / `value_frame_type` reflects
*that unit's own* rules-engine decision, computed from that unit's own
extracted signals. The project-level `stage_2.glass_type.value` /
`stage_3.decision.frame_type.value` still hold one "dominant" value (the
first unit's decision) — that's intentional, used only for project-wide
fields like duty/HST/backpaint that aren't per-unit. **The per-unit values in
`units.<id>.value_glass_type` / `value_frame_type` are the ones to trust for
anything unit-specific** (Excel trigger cells, per-unit pricing, etc.).

If a unit's own value differs from the project-level value, that's not a
bug — it means that unit genuinely has a different spec.

---

## 4. Enum values (unchanged, listed for reference)

`value_glass_type`:
```
GLASS_NO_IGU | GLASS_WITH_IGU | GLASS_2_0 | STAIR_TREAD | NON_WALKABLE | EGR
```

`value_frame_type`:
```
SERIES_2000_RECESSED | SERIES_2000_PEDESTAL |
SERIES_1000_PEDESTAL | SERIES_1000_RECESSED |
PERIMETER_NON_TB | DECK_PERIMETER | ECONOFRAME |
SERIES_3000 | SERIES_2000_WITH_PLATE | SERIES_2000_NON_WALKABLE |
ROUND_FRAME_42 | HORIZONTAL_CAP_SERIES_1000 | VERTICAL_CAP_SERIES_1000 |
MANUAL
```

Any glass/frame code the rules engine produces that is **not** in these
lists (e.g. internal codes like `MODIFIED_SERIES_1000`, `CUSTOM_ROLLED_STEEL`)
is mapped down to one of the above before being sent — GFS-AI never sends a
raw internal code the backend doesn't recognize. Full mapping lives in
`extraction/unified_adapter.py`.

---

## 5. Existing-project vs. new-project detection

When the backend pre-creates a project document (empty schema, all `value`
fields `null`), GFS-AI does **not** treat that as an existing project with
real data. It only treats a project as "existing" (→ routes to
revision/merge instead of fresh extraction) when it finds **real** values:

- at least 2 real dimensions (`value_width_in`/`value_length_in` > 0) across
  units, OR
- a combined signal of ≥1 real dimension AND a real `stage_2.glass_type.value`
  / `stage_3.decision.frame_type.value` / `stage_1.contact_name.value` (i.e.
  not `null`, `""`, `"PENDING"`, `"NOT_STATED"`, or `"MANUAL"`)

No backend change needed here — this is purely internal to GFS-AI's own
`run_new_project()` logic. Documented for backend awareness only, in case the
project-creation flow changes what an "empty" doc looks like.

---

## 6. Natural-language revision support

The customer-facing revision flow (`prompts/9.revision_intent.md` +
`extraction/revision_patcher.py`) now understands grid phrasing like "3x3"
or "3 rows of 3 panels" in follow-up emails/messages, not just a flat panel
count. When a grid is stated, the payload for that unit includes
`value_rows`, `value_cols`, and `value_is_grid_confirmed: true`, with
`value_panel_count` derived as `rows × cols` if the customer didn't also
state a flat count. No backend action needed beyond storing the new fields
from §2a.

---

## 7. Backward compatibility

Everything above is additive. Projects with a single glass/frame spec are
unaffected — every unit ends up with the same value it always would have.
Older documents that predate `unit_label`/`value_rows`/`value_cols` will
simply have those fields `null`/absent; nothing reads them as required.
