# GFS multi-unit contract

This is the contract between the AI stage worker, the GFS backend, and the
estimator workspace. It applies to Stage 4 take-off data and keeps every unit's
frame, glass, and dimension decisions attached to the same unit identity.

## Canonical payload

The preferred AI webhook payload is a Stage 4 result with a unit map under
`fields_to_show.units`:

```json
{
  "stage": 4,
  "fields_to_show": {
    "takeoff": {
      "panel_count": {
        "value": 4,
        "reasoning": ["Sum of the returned unit panel counts."]
      }
    },
    "units": {
      "A": {
        "unit_id": "A",
        "value_frame_type": "SERIES_2000_RECESSED",
        "value_glass_type": "GLASS_WITH_IGU",
        "value_cross_beam": "SERIES_2000_T_SECTION_TB",
        "value_glass_thickness": "1/4 in",
        "value_location": "Lobby",
        "value_drawing_number": "A-101",
        "value_width_in": 48,
        "value_length_in": 72,
        "value_panel_count": 2,
        "value_num_units": 1,
        "value_vertical_rafter_count": 1,
        "value_horizontal_rafter_count": 0,
        "extracted_dim_type": "GLASS",
        "extracted_verbatim": "48 x 72 glass panel",
        "extracted_confidence": 0.94,
        "reasoning": ["Matched the opening dimensions on A-101."]
      }
    }
  }
}
```

The backend normalizes the unit map to the persisted root-level `units` shape
before merging the stage result. The frontend reads the returned `units` map
and edits values using paths such as:

```text
stage_4.units.A.value_frame_type
stage_4.units.A.value_glass_type
stage_4.units.A.value_width_in
```

## Unit identity and isolation

- Valid unit keys are `A` through `J`.
- `unit_id` is optional, but when supplied it must match the map key, ignoring
  case. The server stores it in uppercase.
- A missing unit means “no update”. It does not delete another unit.
- A later AI run may update only the units it knows about. Existing values for
  other units remain unchanged.
- Unit-specific selections must be sent on the unit record. Do not use the
  global Stage 2/3 frame or glass value for a unit-specific decision.

## Unit fields

| Field | Type | Rules |
| --- | --- | --- |
| `value_frame_type` | enum or `null` | One of the frame values below |
| `value_glass_type` | enum or `null` | One of the glass values below |
| `value_cross_beam` | enum or `null` | One of the Crossbeam values in the Stage 4 registry |
| `value_glass_thickness` | string or `null` | Human-readable thickness |
| `value_location` | string or `null` | Unit location/description |
| `value_drawing_number` | string or `null` | Source drawing identifier |
| `value_width_in` | number or `null` | Non-negative inches |
| `value_length_in` | number or `null` | Non-negative inches |
| `value_panel_count` | integer or `null` | Zero or greater |
| `value_num_units` | positive integer or `null` | One or greater when supplied |
| `value_rafter_count` | integer or `null` | Zero or greater |
| `value_vertical_rafter_count` | integer or `null` | Zero or greater |
| `value_horizontal_rafter_count` | integer or `null` | Zero or greater |

Extraction provenance may be included per unit with `extracted_*` fields,
`reasoning`, `flags`, and `extracted_citation`. These fields explain where a
value came from; the `value_*` fields are the values shown and edited by the
estimator.

### Frame values

`SERIES_2000_RECESSED`, `SERIES_2000_PEDESTAL`, `SERIES_1000_PEDESTAL`,
`SERIES_1000_RECESSED`, `PERIMETER_NON_TB`, `DECK_PERIMETER`, `ECONOFRAME`,
`SERIES_3000`, `SERIES_2000_WITH_PLATE`, `SERIES_2000_NON_WALKABLE`,
`ROUND_FRAME_42`, `HORIZONTAL_CAP_SERIES_1000`, `VERTICAL_CAP_SERIES_1000`,
`MANUAL`.

### Glass values

`GLASS_NO_IGU`, `GLASS_WITH_IGU`, `GLASS_2_0`, `STAIR_TREAD`,
`NON_WALKABLE`, `EGR`.

## Compatibility input locations

For existing AI workers, the webhook accepts and normalizes these equivalent
locations, in this precedence order:

1. `units`
2. `stage_4.units`
3. `stage_4.takeoff.units`
4. `fields_to_show.units`
5. `fields_to_show.stage_4.units`
6. `fields_to_show.stage_4.takeoff.units`

New workers should use `fields_to_show.units`. If more than one location is
sent, the maps are merged per unit key with the first location above winning
per key.

Invalid keys, mismatched `unit_id` values, invalid enum values, negative
dimensions, non-integer counts, or a zero `value_num_units` are rejected with
HTTP 400 before the AI result is merged.

## Frontend behavior

The Stage 4 Parameters screen displays the unit-specific frame type, glass
type, Crossbeam type, glass thickness, dimensions, panel count, unit count,
and crossbeam counts. When unit Crossbeam decisions are present, they are
shown in a separate detailed unit table with AI reasoning and confidence,
matching the Glass Type and Frame Type screens. Crossbeam values use the
backend-provided `unit_field_meta.allowed_values` list, so the editor cannot
select an unsupported option. Edits remain scoped to the selected unit.

When an AI-provided value is changed by an estimator, the existing feedback
queue records one correction request for that unit and lists the changed
columns, including frame and glass type.

## Change-control rules

- Keep field names in `snake_case`.
- Use `null` for an explicitly unknown value; do not invent a default frame or
  glass type.
- Keep the unit map sparse: send only units returned or changed by the worker.
- Preserve extraction provenance when revising a `value_*` field.
- Do not rename `value_*` keys without updating the backend contract, the
  frontend mirror types, and the focused contract tests together.
