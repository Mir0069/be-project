"""
spec_codes.py — the glass, frame, crossbeam and status values GFS-backend accepts
on a unit (mirror of multi-unit.contract.ts), and the wording people use for them.

The backend rejects any other value, and a rejected unit value used to fail the
whole stage result, so every unit spec leaving this service goes through here.
"""
import re
from typing import Any, Iterator, List, Optional

GLASS_CODES = frozenset({
    "GLASS_NO_IGU", "GLASS_WITH_IGU", "GLASS_2_0",
    "STAIR_TREAD", "NON_WALKABLE", "EGR",
})
FRAME_CODES = frozenset({
    "SERIES_2000_RECESSED", "SERIES_2000_PEDESTAL",
    "SERIES_1000_PEDESTAL", "SERIES_1000_RECESSED",
    "PERIMETER_NON_TB", "DECK_PERIMETER", "ECONOFRAME",
    "SERIES_3000", "SERIES_2000_WITH_PLATE",
    "SERIES_2000_NON_WALKABLE", "ROUND_FRAME_42",
    "HORIZONTAL_CAP_SERIES_1000", "VERTICAL_CAP_SERIES_1000",
    "MANUAL",
})
CROSSBEAM_CODES = frozenset({
    "T_SECTION_NTB", "T_SECTION_TB", "I_BEAM_NTB", "I_BEAM_TB", "I_BEAM_TB_2000",
    "SERIES_1000_T_SECTION_TB", "SERIES_1000_I_BEAM_TB",
    "SERIES_1000_T_SECTION", "SERIES_1000_I_BEAM",
    "SERIES_2000_T_SECTION_TB", "SERIES_2000_I_BEAM_TB",
    "ECONOFRAME_2_5", "ECONOFRAME_3_5", "NO_BEAM", "MANUAL",
})
UNIT_STATUSES = frozenset({"PENDING", "SAVED", "APPROVED", "NEEDS_REVIEW"})
INSTALL_TYPES = frozenset({"PEDESTAL", "RECESSED", "CURB_MOUNTED", "DECK_PERIMETER", "NOT_STATED"})


def _words(value: str) -> str:
    """Upper-case words only: 'Glass 2.0' -> 'GLASS 2 0', 'SERIES_2000' -> 'SERIES 2000'."""
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", value.upper()).split())


_GLASS_ALIASES = {
    "NO IGU": "GLASS_NO_IGU",
    "WITHOUT IGU": "GLASS_NO_IGU",
    "GLASS WITHOUT IGU": "GLASS_NO_IGU",
    "NON IGU": "GLASS_NO_IGU",
    "NON INSULATED": "GLASS_NO_IGU",
    "IGU": "GLASS_WITH_IGU",
    "WITH IGU": "GLASS_WITH_IGU",
    "INSULATED GLASS UNIT": "GLASS_WITH_IGU",
    "INSULATED GLASS": "GLASS_WITH_IGU",
    "INSULATED GLAZING": "GLASS_WITH_IGU",
    "DOUBLE INSULATED GLAZING": "GLASS_WITH_IGU",
    "TRIPLE INSULATED GLAZING": "GLASS_WITH_IGU",
    "NOT WALKABLE": "NON_WALKABLE",
    "STAIR TREADS": "STAIR_TREAD",
}

_FRAME_ALIASES = {
    "PERIMETER NTB": "PERIMETER_NON_TB",
    "PERIMETER NON TB": "PERIMETER_NON_TB",
    "PERIMETER NON THERMALLY BROKEN": "PERIMETER_NON_TB",
    "ECONO FRAME": "ECONOFRAME",
    "EFRAME": "ECONOFRAME",
    "E FRAME": "ECONOFRAME",
    "S3000": "SERIES_3000",
    "S 3000": "SERIES_3000",
    "3000 SERIES": "SERIES_3000",
    "ROUND FRAME": "ROUND_FRAME_42",
    "CUSTOM ROLLED STEEL": "MANUAL",
}

# Series 1000/2000 need a mount to become a code: "Series 2000 recessed".
_SERIES_WITH_MOUNT = re.compile(r"\b(?:SERIES|S)\s?(1000|2000)\b|\b(1000|2000) SERIES\b")
_SERIES_3000 = re.compile(r"\b(?:SERIES|S)\s?3000\b|\b3000 SERIES\b")
_MOUNT_WORDS = {"RECESSED": "RECESS", "PEDESTAL": "PEDESTAL"}

# "no pedestal", "do not use Series 2000 or Series 3000": the few words after a
# negation, up to punctuation or "but"/"instead", are what the text rules out.
_NEGATIONS = frozenset({"NO", "NOT", "NON", "WITHOUT", "NEVER", "DON", "DONT", "DOESN", "ISN", "AVOID"})
_NEGATION_BREAKS = frozenset({".", ";", ",", "!", "?", "BUT", "INSTEAD", "RATHER"})
_NEGATION_REACH = 6

_CROSSBEAM_ALIASES = {
    "NONE": "NO_BEAM",
    "NO BEAM": "NO_BEAM",
    "ECONOFRAME 25": "ECONOFRAME_2_5",
    "ECONOFRAME 35": "ECONOFRAME_3_5",
}


def normalize_glass_code(value: Any) -> Optional[str]:
    """The backend glass code a value names, or None (make-up text such as '10MM LOW IRON')."""
    if not isinstance(value, str) or not value.strip():
        return None
    words = _words(value)
    code = words.replace(" ", "_")
    if code in GLASS_CODES:
        return code
    return _GLASS_ALIASES.get(words)


def _split_negated(value: str) -> tuple:
    """(stated words, ruled-out words) of free text."""
    stated: List[str] = []
    negated: List[str] = []
    reach = 0
    for token in re.findall(r"[A-Z0-9]+|[.;,!?]", value.upper()):
        if token in _NEGATION_BREAKS:
            reach = 0
        elif token in _NEGATIONS:
            reach = _NEGATION_REACH
        else:
            (negated if reach else stated).append(token)
            reach = max(reach - 1, 0)
    return " ".join(stated), " ".join(negated)


def _mount_of(stated: str, negated: str, install_type: Any) -> Optional[str]:
    """The stated mount, else the project's, else the only one not ruled out."""
    stated_mounts = {mount for mount, word in _MOUNT_WORDS.items() if word in stated}
    if stated_mounts:
        return stated_mounts.pop() if len(stated_mounts) == 1 else None
    ruled_out = {mount for mount, word in _MOUNT_WORDS.items() if word in negated}
    install = _words(install_type).replace(" ", "_") if isinstance(install_type, str) else ""
    if install in _MOUNT_WORDS and install not in ruled_out:
        return install
    remaining = set(_MOUNT_WORDS) - ruled_out
    return remaining.pop() if ruled_out and len(remaining) == 1 else None


def normalize_frame_code(value: Any, install_type: Any = None) -> Optional[str]:
    """The backend frame code a value names, or None. A bare 'Series 2000' needs the install type."""
    if not isinstance(value, str) or not value.strip():
        return None
    words = _words(value)
    code = words.replace(" ", "_")
    if code in FRAME_CODES:
        return code
    if code == "MODIFIED_SERIES_1000":
        return "SERIES_1000_RECESSED" if _mount_of("", "", install_type) == "RECESSED" else "SERIES_1000_PEDESTAL"
    if code in ("BLANK", "PENDING", "NOT_STATED"):
        return None
    if words in _FRAME_ALIASES:
        return _FRAME_ALIASES[words]
    stated, negated = _split_negated(value)
    families = {m.group(1) or m.group(2) for m in _SERIES_WITH_MOUNT.finditer(stated)}
    if _SERIES_3000.search(stated):
        families.add("3000")
    if len(families) != 1:
        return None
    family = families.pop()
    if family == "3000":
        return "SERIES_3000"
    mount = _mount_of(stated, negated, install_type)
    return f"SERIES_{family}_{mount}" if mount else None


def normalize_crossbeam_code(value: Any) -> Optional[str]:
    """The backend crossbeam code a value names, or None."""
    if not isinstance(value, str) or not value.strip():
        return None
    words = _words(value)
    code = words.replace(" ", "_")
    if code in ("BLANK", "PENDING"):
        return None
    if code in CROSSBEAM_CODES:
        return code
    return _CROSSBEAM_ALIASES.get(words)


_UNIT_SPEC_FIELDS = (
    ("value_glass_type", normalize_glass_code, "glass"),
    ("extracted_glass_type", normalize_glass_code, None),
    ("value_frame_type", normalize_frame_code, "frame"),
    ("extracted_frame_type", normalize_frame_code, None),
    ("value_cross_beam", normalize_crossbeam_code, None),
    ("extracted_cross_beam", normalize_crossbeam_code, None),
    ("value_crossbeam", normalize_crossbeam_code, None),
    ("extracted_crossbeam", normalize_crossbeam_code, None),
)


def sanitize_unit_specs(unit: dict, *, keep_keys: bool = False) -> List[str]:
    """
    Replace each unit spec with the backend code it names. A value naming none is
    dropped, since the backend writes a null over the stored value; keep_keys sets
    it to None instead (a freshly built unit). The drawing text is kept as a
    reasoning line. Drops an unknown status. Mutates the unit; returns changed keys.
    """
    changed: List[str] = []
    if not isinstance(unit, dict):
        return changed
    for key, normalize, label in _UNIT_SPEC_FIELDS:
        raw = unit.get(key)
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            continue
        code = normalize(raw)
        if code == raw:
            continue
        if code is None and not keep_keys:
            del unit[key]
        else:
            unit[key] = code
        changed.append(key)
        if code is None and label and isinstance(raw, str):
            note = f'Drawing states {label} "{raw.strip()}" (not a GFS {label} type; estimator to choose)'
            reasoning = unit.get("reasoning") if isinstance(unit.get("reasoning"), list) else []
            if note not in reasoning:
                unit["reasoning"] = reasoning + [note]
    status = unit.get("status")
    if status is not None and status not in UNIT_STATUSES:
        unit.pop("status", None)
        changed.append("status")
    return changed


def _unit_maps(node: Any, depth: int = 0) -> Iterator[dict]:
    """Every A-J unit map inside a result payload (units, stage_4.units, fields_to_show.units, ...)."""
    if depth > 4 or not isinstance(node, dict):
        return
    for key, value in node.items():
        if key == "units" and isinstance(value, dict):
            yield value
        elif isinstance(value, dict):
            yield from _unit_maps(value, depth + 1)


def sanitize_result_units(payload: Any) -> int:
    """Sanitize every unit in an outgoing result payload; returns how many values changed."""
    changed = 0
    for units in _unit_maps(payload):
        for unit in units.values():
            changed += len(sanitize_unit_specs(unit))
    return changed
