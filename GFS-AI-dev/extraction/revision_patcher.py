"""
revision_patcher.py — Applies structured LLM-generated actions to MongoDB schema.
LLM classifies intent and outputs a small JSON patch. Python applies it deterministically.
"""
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from extraction.spec_codes import INSTALL_TYPES, normalize_frame_code, normalize_glass_code

logger = logging.getLogger("gfs.revision_patcher")

UNIT_LETTERS = "ABCDEFGHIJ"

# Unit spec keys the patcher writes, keyed by the names the LLM uses.
_UNIT_SPEC_KEYS = {
    "glass_type": "value_glass_type",
    "value_glass_type": "value_glass_type",
    "frame_type": "value_frame_type",
    "value_frame_type": "value_frame_type",
}
# Project-level homes of the same specs.
_PROJECT_SPEC_PATHS = {
    "value_glass_type": ("stage_2", "glass_type"),
    "value_frame_type": ("stage_3", "decision", "frame_type"),
}
_INSTALL_PATH = ("stage_3", "_signals", "install_type")


def _is_real_unit(unit: Any) -> bool:
    """A unit the estimator can see; empty A-J slots pre-seeded by the backend are not."""
    from extraction.unified_adapter import _has_takeoff_data
    return isinstance(unit, dict) and (
        _has_takeoff_data(unit) or bool(unit.get("value_glass_type") or unit.get("value_frame_type"))
    )


def _get_path(schema: dict, path: tuple) -> Any:
    node: Any = schema
    for part in path:
        node = node.get(part) if isinstance(node, dict) else None
    return node


def _compact_existing(schema: dict) -> str:
    """Build compact summary of existing project state for LLM context."""
    lines = []
    for uid, u in (schema.get("units") or {}).items():
        if not _is_real_unit(u):
            continue
        w = u.get("value_width_in")
        l = u.get("value_length_in")
        loc = (u.get("value_location") or "")[:120]
        panels = u.get("value_panel_count")
        lines.append(
            f"Unit {uid}: {w}x{l}in | panels={panels} | {loc} | glass={u.get('value_glass_type')} "
            f"| frame={u.get('value_frame_type')} | status={u.get('status', '')}"
        )
    frame = _get_path(schema, ("stage_3", "decision", "frame_type"))
    if isinstance(frame, dict) and frame.get("value") is not None:
        lines.append(f"stage_3.decision.frame_type={frame['value']} (status={frame.get('status', '')})")
    # Key signals
    for stage in ["stage_1", "stage_2", "stage_3", "stage_5"]:
        data = schema.get(stage, {})
        if not isinstance(data, dict):
            continue
        for key, val in data.items():
            if key.startswith("_"):
                continue
            if isinstance(val, dict) and val.get("value") is not None:
                reasoning = val.get("reasoning", [])
                reasoning_str = f" | reasoning: {reasoning[0][:80]}" if reasoning else ""
                lines.append(f"{stage}.{key}={val.get('value','')} (status={val.get('status','')}){reasoning_str}")
    return "\n".join(lines)


def _compact_new(extraction: dict) -> str:
    """Build compact summary of new extraction for LLM."""
    lines = []
    # Units from new extraction
    for u in extraction.get("units", []):
        label = u.get("unit_label", "unknown")
        w = u.get("width_inches")
        l = u.get("length_inches")
        loc = (u.get("location_description") or "")[:120]
        verb = (u.get("verbatim") or "")[:150]
        panels = u.get("panel_count")
        dim = f"{w}x{l}in" if w and l else "no dims"
        lines.append(f"- {label}: {dim} | panels={panels} | {loc}")
        if verb:
            lines.append(f"  verbatim: {verb}")
    # Signals
    for sig_type in ["header_signals", "glass_signals", "frame_signals", "location_signals", "addon_signals"]:
        sigs = extraction.get(sig_type, {})
        if not isinstance(sigs, dict):
            continue
        for field_name, sig in sigs.items():
            if isinstance(sig, dict) and sig.get("value") is not None:
                verb = sig.get("verbatim") or ""
                reasoning = sig.get("reasoning") or ""
                lines.append(f"- {sig_type}.{field_name}={sig['value']} | {verb[:80]} | reasoning: {reasoning[:80]}")
    return "\n".join(lines) if lines else json.dumps(extraction, indent=2, default=str)[:2000]


def parse_revision_actions(llm_response: str) -> dict:
    """Parse LLM JSON response into actions dict."""
    text = llm_response.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


# Map common LLM field names to MongoDB schema field names
FIELD_MAP = {
    "width": "value_width_in",
    "width_in": "value_width_in",
    "width_inches": "value_width_in",
    "value_width_in": "value_width_in",
    "length": "value_length_in",
    "length_in": "value_length_in",
    "length_inches": "value_length_in",
    "value_length_in": "value_length_in",
    "panels": "value_panel_count",
    "panel_count": "value_panel_count",
    "value_panel_count": "value_panel_count",
    "rows": "value_rows",
    "row_count": "value_rows",
    "value_rows": "value_rows",
    "cols": "value_cols",
    "columns": "value_cols",
    "column_count": "value_cols",
    "value_cols": "value_cols",
    "value_columns": "value_cols",
    "location": "value_location",
    "value_location": "value_location",
    "grid_confirmed": "value_is_grid_confirmed",
    "is_grid_confirmed": "value_is_grid_confirmed",
    "value_is_grid_confirmed": "value_is_grid_confirmed",
}


def _as_grid_int(v):
    """Parse a grid dimension (rows/cols) to int, or None."""
    try:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def _normalize_grid_changes(changes: dict) -> dict:
    """Handle grid phrasing ("3x3", "3 rows of 3 panels"): normalize to
    value_rows/value_cols(+alias)/value_is_grid_confirmed and derive
    value_panel_count = rows × cols when the customer did not state a
    flat count (contract §6)."""
    changes = dict(changes or {})
    rows = None
    cols = None
    for k in ("value_rows", "rows"):
        rows = _as_grid_int(changes.get(k))
        if rows is not None:
            break
    for k in ("value_cols", "value_columns", "columns", "cols"):
        cols = _as_grid_int(changes.get(k))
        if cols is not None:
            break
    if rows is not None and cols is not None:
        changes["value_rows"] = rows
        changes["value_cols"] = cols
        changes["value_columns"] = cols
        changes["value_is_grid_confirmed"] = True
        panel_stated = any(
            _as_grid_int(changes.get(k)) is not None
            for k in ("value_panel_count", "panel_count", "panels")
        )
        if not panel_stated:
            changes["value_panel_count"] = rows * cols
    return changes


def _normalize_spec(unit_key: str, value: Any, install_type: Any = None) -> Optional[str]:
    """Backend code for a glass/frame value, or None when the value names none."""
    if unit_key == "value_glass_type":
        return normalize_glass_code(value)
    return normalize_frame_code(value, install_type)


def _map_signal_code(field_path: str, new_val, install_type: Any = None):
    """Backend code for a project glass/frame write, with a note when it was mapped.
    Returns (None, note) when the value names no backend code, so it is skipped
    instead of persisting a value the backend would reject."""
    if not isinstance(new_val, str):
        return new_val, ""
    leaf = (field_path or "").strip().lower()
    if leaf.endswith("frame_type") or leaf.endswith("glass_type"):
        unit_key = "value_frame_type" if leaf.endswith("frame_type") else "value_glass_type"
        mapped = _normalize_spec(unit_key, new_val, install_type)
        if mapped is None:
            return None, f" (no GFS code for '{new_val}')"
        if mapped != new_val.strip().upper():
            return mapped, f" (mapped {new_val} to {mapped})"
        return mapped, ""
    return new_val, ""


def _customer_reason(verbatim: str) -> str:
    """Reasoning line for an explicit customer instruction."""
    if verbatim and verbatim.lower().startswith("customer stated:"):
        return verbatim
    return f"Customer stated: {verbatim}" if verbatim else "Customer stated change"


def _record_reason(node: dict, verbatim: str, customer_stated: bool) -> None:
    """Customer statements replace prior derivation; other verbatim text is appended once."""
    if customer_stated:
        node.setdefault("_meta", {})
        node["_meta"]["manual"] = True
        node["_meta"]["customer_stated"] = True
        node["reasoning"] = [_customer_reason(verbatim)]
    elif verbatim:
        existing = node.get("reasoning") or []
        if verbatim not in existing:
            node["reasoning"] = existing + [verbatim]


def _flag(raw: Any) -> bool:
    """LLM booleans sometimes arrive as strings; "false" must stay false."""
    if isinstance(raw, str):
        return raw.strip().lower() in ("true", "yes", "1")
    return bool(raw)


def _unit_letter(raw: Any) -> Optional[str]:
    """'Unit A', 'unitB', 'b' -> 'A'/'B'; anything else -> None."""
    if not isinstance(raw, str):
        return None
    m = re.fullmatch(r"\s*(?:UNIT\s*)?([A-J])\s*\.?\s*", raw.upper())
    return m.group(1) if m else None


@dataclass
class _Action:
    intent: str
    target: Optional[str]
    changes: Dict[str, Any]
    verbatim: str
    customer_stated: bool
    match_reason: str
    raw: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, action: dict) -> "_Action":
        changes = action.get("changes") if isinstance(action.get("changes"), dict) else {}
        return cls(
            intent=str(action.get("intent") or ""),
            target=_unit_letter(action.get("target_unit")),
            changes=changes,
            verbatim=action.get("verbatim") or "",
            customer_stated=_flag(action.get("customer_stated", False)),
            match_reason=action.get("match_reason") or "",
            raw=action,
        )


class _Patch:
    """One run of actions over a schema, with its applied-change log."""

    def __init__(self, schema: dict):
        self.schema = schema
        self.units: dict = schema.get("units") or {}
        schema["units"] = self.units
        self.stage_1: dict = schema.get("stage_1") or {}
        schema["stage_1"] = self.stage_1
        self.applied: List[str] = []
        self.spec_changed_by_customer: Dict[str, bool] = {}

    def _install(self, act: _Action) -> Any:
        """The mount a bare 'Series 2000' takes: the one stated with it, else the project's."""
        stated = next((v for k, v in act.changes.items() if k.endswith("install_type") and v), None)
        stored = _get_path(self.schema, _INSTALL_PATH)
        return stated or (stored.get("value") if isinstance(stored, dict) else None)

    def _only_unit(self) -> Optional[str]:
        """Where an untargeted unit change goes: the project's only real unit (slot A before any is filled)."""
        real = [letter for letter, unit in self.units.items() if _is_real_unit(unit)]
        if len(real) == 1:
            return real[0]
        return "A" if not real and "A" in self.units else None

    # ── Unit specs ─────────────────────────────────────────────────────────
    def set_unit_spec(self, letter: str, unit_key: str, value: Any, act: _Action, install_type: Any = None) -> None:
        unit = self.units.get(letter)
        if not isinstance(unit, dict):
            self.applied.append(f"SKIPPED Unit {letter}.{unit_key} — unit not found")
            return
        code = _normalize_spec(unit_key, value, install_type)
        if code is None:
            self.applied.append(f"SKIPPED Unit {letter}.{unit_key} — no GFS code for '{value}'")
            return
        if (unit.get("_meta") or {}).get("manual") and not act.customer_stated:
            self.applied.append(f"SKIPPED Unit {letter}.{unit_key} — manually approved (no customer override)")
            return
        old = unit.get(unit_key)
        unit[unit_key] = code
        unit["status"] = "NEEDS_REVIEW"
        _record_reason(unit, act.verbatim, act.customer_stated)
        self.spec_changed_by_customer[unit_key] = self.spec_changed_by_customer.get(unit_key, False) or act.customer_stated
        self.applied.append(f"UPDATED Unit {letter}.{unit_key}: {old} -> {code} | {act.verbatim}")

    def sync_project_specs(self) -> None:
        """When every real unit now shares a spec, the project value follows it."""
        for unit_key, customer_stated in self.spec_changed_by_customer.items():
            values = {u.get(unit_key) for u in self.units.values() if _is_real_unit(u)}
            if len(values) != 1 or None in values:
                continue
            value = values.pop()
            node = _get_path(self.schema, _PROJECT_SPEC_PATHS[unit_key])
            if not isinstance(node, dict) or node.get("value") == value:
                continue
            old = node.get("value")
            node["value"] = value
            node["status"] = "NEEDS_REVIEW"
            node["reasoning"] = [f"All units now use {value}" + (" (customer stated)" if customer_stated else "")]
            if customer_stated:
                # Stops the rules engine re-deriving it from older drawing signals.
                node.setdefault("_meta", {}).update({"manual": True, "customer_stated": True})
            self.applied.append(f"UPDATED {'.'.join(_PROJECT_SPEC_PATHS[unit_key])}: {old} -> {value} (all units agree)")

    # ── Intents ────────────────────────────────────────────────────────────
    def update_dimensions(self, act: _Action) -> None:
        target = act.target if act.target in self.units else self._only_unit()
        if target is None:
            self.applied.append(f"SKIPPED {act.intent} — no single unit to update | {act.verbatim}")
            return
        unit = self.units[target]
        changes = _normalize_grid_changes(act.changes)
        grid_fields_touched = False
        for field_name, new_val in changes.items():
            unit_key = _UNIT_SPEC_KEYS.get(field_name)
            if unit_key:
                self.set_unit_spec(target, unit_key, new_val, act, self._install(act))
                continue
            if field_name.endswith("install_type"):
                continue
            field_name = FIELD_MAP.get(field_name, field_name)
            if field_name in ("value_rows", "value_cols", "value_columns"):
                grid_fields_touched = True
            old_val = unit.get(field_name)
            # Don't overwrite manually approved values — UNLESS customer explicitly states a new value
            if (unit.get("_meta") or {}).get("manual") and not act.customer_stated:
                self.applied.append(f"SKIPPED Unit {target}.{field_name} — manually approved (no customer override)")
                continue
            unit[field_name] = new_val
            # Keep the value_columns alias in sync with value_cols.
            if field_name == "value_cols":
                unit["value_columns"] = new_val
            elif field_name == "value_columns":
                unit["value_cols"] = new_val
            unit["status"] = "NEEDS_REVIEW"
            _record_reason(unit, act.verbatim, act.customer_stated)
            self.applied.append(f"UPDATED Unit {target}.{field_name}: {old_val} -> {new_val} | {act.verbatim}")
        # A stated grid (e.g. "3x3") confirms the layout for Rule 4's rafter math
        # and, if the customer didn't separately give a flat panel count, derives it.
        if grid_fields_touched:
            rows, cols = unit.get("value_rows"), unit.get("value_cols")
            if isinstance(rows, (int, float)) and isinstance(cols, (int, float)) and rows > 0 and cols > 0:
                unit["value_is_grid_confirmed"] = True
                if not any(k in changes for k in ("value_panel_count", "panel_count", "panels")):
                    unit["value_panel_count"] = int(rows) * int(cols)
                    self.applied.append(f"DERIVED Unit {target}.value_panel_count: {int(rows) * int(cols)} (from {int(rows)}x{int(cols)} grid)")

    def update_unit_spec(self, act: _Action) -> None:
        target = act.target if act.target in self.units else self._only_unit()
        if target is None:
            self.applied.append(f"SKIPPED {act.intent} — unknown unit '{act.raw.get('target_unit')}' | {act.verbatim}")
            return
        # A unit spec is always an explicit instruction about that unit.
        if "customer_stated" not in act.raw:
            act.customer_stated = True
        install = self._install(act)
        for key, value in act.changes.items():
            unit_key = _UNIT_SPEC_KEYS.get(key)
            if unit_key:
                self.set_unit_spec(target, unit_key, value, act, install)

    def update_signal(self, act: _Action) -> None:
        install = self._install(act)
        for field_path, new_val in act.changes.items():
            leaf = field_path.split(".")[-1]
            unit_key = _UNIT_SPEC_KEYS.get(leaf)
            if unit_key and act.target:
                # A glass/frame statement about one unit is a unit spec, not a project value.
                self.set_unit_spec(act.target, unit_key, new_val, act, install)
                continue
            if leaf == "install_type":
                self._write_install_type(new_val, act)
                continue
            self._write_project_signal(field_path, new_val, act, install)
            if unit_key and act.customer_stated:
                # A project-wide instruction applies to every unit.
                for letter, unit in self.units.items():
                    if _is_real_unit(unit):
                        self.set_unit_spec(letter, unit_key, new_val, act, install)

    def _write_install_type(self, value: Any, act: _Action) -> None:
        code = str(value or "").strip().upper().replace(" ", "_")
        node = _get_path(self.schema, _INSTALL_PATH)
        if code not in INSTALL_TYPES or not isinstance(node, dict):
            self.applied.append(f"SKIPPED stage_3._signals.install_type — '{value}'")
            return
        old = node.get("value")
        node["value"] = code
        node["status"] = "NEEDS_REVIEW"
        _record_reason(node, act.verbatim, act.customer_stated)
        self.applied.append(f"UPDATED stage_3._signals.install_type: {old} -> {code}")

    def _write_project_signal(self, field_path: str, new_val: Any, act: _Action, install: Any) -> None:
        parts = field_path.split(".")
        obj: Any = self.schema
        for part in parts[:-1]:
            obj = obj.get(part, {}) if isinstance(obj, dict) else {}
        leaf_key = parts[-1]
        # Fallback to _signals if leaf_key not found directly in obj
        if isinstance(obj, dict) and leaf_key not in obj and isinstance(obj.get("_signals"), dict) and leaf_key in obj["_signals"]:
            obj = obj["_signals"]
        if not (isinstance(obj, dict) and leaf_key in obj):
            self.applied.append(f"FIELD NOT FOUND: {field_path}")
            return
        sig = obj[leaf_key]
        if not isinstance(sig, dict):
            obj[leaf_key] = new_val
            self.applied.append(f"UPDATED {field_path}: -> {new_val}")
            return
        old_val = sig.get("value")
        if (sig.get("_meta") or {}).get("manual") and not act.customer_stated:
            self.applied.append(f"SKIPPED {field_path} -- customer-stated value '{old_val}' preserved (new signal not explicit)")
            return
        mapped, note = _map_signal_code(field_path, new_val, install)
        if mapped is None:
            self.applied.append(f"SKIPPED {field_path}{note}")
            return
        sig["value"] = mapped
        sig["status"] = "NEEDS_REVIEW"
        _record_reason(sig, act.verbatim, act.customer_stated)
        self.applied.append(f"UPDATED {field_path}: {old_val} -> {mapped}{note}")

    def add_unit(self, act: _Action) -> None:
        # Pre-seeded empty A-J slots count as free.
        letter = next((l for l in UNIT_LETTERS if not _is_real_unit(self.units.get(l))), None)
        if letter is None:
            self.applied.append(f"SKIPPED ADD_UNIT — all ten units are in use | {act.verbatim}")
            return
        mapped = {FIELD_MAP.get(k, k): v for k, v in _normalize_grid_changes(act.changes).items()}
        if mapped.get("value_cols") is not None and mapped.get("value_columns") is None:
            mapped["value_columns"] = mapped["value_cols"]
        existing = self.units.get(letter) if isinstance(self.units.get(letter), dict) else {}
        new_unit = {
            **existing,
            "unit_id": letter,
            "status": "NEEDS_REVIEW",
            "unit_label": act.changes.get("unit_label") or act.changes.get("label"),
            "value_width_in": mapped.get("value_width_in"),
            "value_length_in": mapped.get("value_length_in"),
            "value_panel_count": mapped.get("value_panel_count"),
            "value_rows": mapped.get("value_rows"),
            "value_cols": mapped.get("value_cols"),
            "value_columns": mapped.get("value_columns"),
            "value_is_grid_confirmed": mapped.get("value_is_grid_confirmed"),
            "value_location": mapped.get("value_location", act.match_reason),
        }
        reason = _customer_reason(act.verbatim) if act.customer_stated else act.verbatim
        new_unit["reasoning"] = [reason] if reason else []
        if act.customer_stated:
            new_unit["_meta"] = {"manual": True, "customer_stated": True}
        self.units[letter] = new_unit
        self.applied.append(f"ADDED Unit {letter}: {act.changes} | {act.verbatim}")
        install = self._install(act)
        for key, value in act.changes.items():
            unit_key = _UNIT_SPEC_KEYS.get(key)
            if unit_key:
                self.set_unit_spec(letter, unit_key, value, act, install)

    def remove_unit(self, act: _Action) -> None:
        unit = self.units.get(act.target) if act.target else None
        if not isinstance(unit, dict):
            self.applied.append(f"SKIPPED REMOVE_UNIT — unknown unit '{act.raw.get('target_unit')}' | {act.verbatim}")
            return
        # Clearing the take-off values removes the unit the same way the estimator's Remove does.
        for key in list(unit.keys()):
            if (key.startswith("value_") or key.startswith("extracted_")) and key != "value_num_units":
                unit[key] = None
        unit["status"] = "NEEDS_REVIEW"
        unit["reasoning"] = [_customer_reason(act.verbatim) if act.customer_stated else (act.verbatim or "Unit removed")]
        self.applied.append(f"REMOVED Unit {act.target} | {act.verbatim}")

    def update_header(self, act: _Action) -> None:
        for field_name, new_val in act.changes.items():
            node = self.stage_1.get(field_name)
            if not isinstance(node, dict):
                continue
            old_val = node.get("value")
            node["value"] = new_val
            node["status"] = "NEEDS_REVIEW"
            _record_reason(node, act.verbatim, act.customer_stated)
            self.applied.append(f"UPDATED stage_1.{field_name}: {old_val} -> {new_val}")

    def general_note(self, act: _Action) -> None:
        self.applied.append(f"NOTE: {act.verbatim}")


_HANDLERS: Dict[str, Callable[[_Patch, _Action], None]] = {
    "UPDATE_DIMENSION": _Patch.update_dimensions,
    "UPDATE_PANEL_COUNT": _Patch.update_dimensions,
    "UPDATE_UNIT_SPEC": _Patch.update_unit_spec,
    "UPDATE_SIGNAL": _Patch.update_signal,
    "ADD_UNIT": _Patch.add_unit,
    "REMOVE_UNIT": _Patch.remove_unit,
    "UPDATE_HEADER": _Patch.update_header,
    "GENERAL_NOTE": _Patch.general_note,
}


def apply_actions_to_schema(schema: dict, actions: list) -> tuple:
    """
    Apply each action to the schema deterministically.
    Returns (updated_schema, applied_log).
    """
    patch = _Patch(schema)
    for raw in actions or []:
        if not isinstance(raw, dict):
            continue
        act = _Action.from_dict(raw)
        handler = _HANDLERS.get(act.intent)
        if handler is None:
            patch.applied.append(f"UNHANDLED: {act.intent} target={act.target} | {act.verbatim}")
            continue
        handler(patch, act)
    patch.sync_project_specs()
    return patch.schema, patch.applied


def run_revision(existing_schema: dict, new_extraction: dict, context: Optional[Any] = None) -> dict:
    """
    Main entry: reads existing schema + new extraction + optional context notes,
    calls LLM for intent classification, applies patches deterministically.
    """
    from extraction.vision_client import call_vision_batch
    from prompts.prompt_loader import load_prompt
    from utils.io_utils import format_revision_context

    existing_summary = _compact_existing(existing_schema)
    new_summary = _compact_new(new_extraction)

    context_str = format_revision_context(context)
    if context_str and context_str.strip():
        new_summary += f"\n\nADDITIONAL USER CONTEXT / NOTES:\n{context_str.strip()}"

    system_prompt = load_prompt("9.revision_intent.md")
    user_prompt = f"EXISTING PROJECT STATE:\n{existing_summary}\n\nNEW INFORMATION:\n{new_summary}"
    logger.info("REVISION PATCHER CALLED — existing_units=%d, new_text_len=%d, has_context=%s",
                len(existing_summary.splitlines()), len(new_summary), bool(context_str and context_str.strip()))

    # Call LLM — small output, only structured actions
    result = call_vision_batch(
        image_blocks=[],
        prompt=system_prompt + "\n\n" + user_prompt,
    )

    if not result.get("ok", True) or not result.get("text"):
        logger.warning("Revision intent LLM failed: %s — returning existing schema", result.get("error"))
        return existing_schema

    try:
        parsed = parse_revision_actions(result["text"])
        actions = parsed.get("actions", [])
        summary = parsed.get("summary", "")

        if not actions:
            logger.info("No revision actions detected: %s", summary)
            return existing_schema

        updated_schema, applied_log = apply_actions_to_schema(existing_schema, actions)

        logger.info("Revision applied: %s", summary)
        for log_line in applied_log:
            logger.info("  %s", log_line)

        return updated_schema

    except (json.JSONDecodeError, KeyError) as exc:
        logger.error("Failed to parse revision actions: %s", exc)
        return existing_schema
