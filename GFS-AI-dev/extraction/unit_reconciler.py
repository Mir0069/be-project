"""
unit_reconciler.py — LLM-based Cross-Document Unit Reconciler for GFS-AI
"""

from new_app import token_tracker
import json
import os
import re
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

AZURE_OPENAI_API_KEY    = (os.environ.get("AZURE_OPENAI_API_KEY") or os.environ.get("AZURE_OPENAI_KEY", "")).strip()
AZURE_OPENAI_BASE_URL   = (os.environ.get("AZURE_OPENAI_BASE_URL") or os.environ.get("AZURE_OPENAI_ENDPOINT") or "https://expedientai.services.ai.azure.com/api/projects/expedientAIProject/openai/v1").strip()
AZURE_OPENAI_DEPLOYMENT = (os.environ.get("AZURE_OPENAI_DEPLOYMENT") or os.environ.get("AZURE_OPENAI_CHAT_DEPLOYMENT") or "gpt-4o-mini").strip()

from prompts.prompt_loader import load_prompt

def get_openai_client() -> OpenAI:
    return OpenAI(base_url=AZURE_OPENAI_BASE_URL, api_key=AZURE_OPENAI_API_KEY)

RECONCILER_SYSTEM_PROMPT = load_prompt("8.unit_reconciler.md")


# ── Deterministic pre-merge (runs before the LLM) ─────────────────────
# Conservative by design: merges ONLY entries that are numerically the same
# opening restated across documents (rounding, mm→in, foot-mark typos).
# Anything ambiguous (conflicting dims, distinct rooms/counts) is left for
# the LLM prompt rules, which merge-with-flag instead of splitting.
_DIM_TOL_IN = 1.0   # absolute tolerance per axis (covers mm→in rounding)
_DIM_TOL_FRAC = 0.05  # relative tolerance per axis, whichever is larger

# Generic words ignored when comparing location labels.
_LOCATION_STOPWORDS = frozenset({
    "the", "and", "for", "are", "with", "over", "into", "unit", "units",
    "glass", "glazing", "floor", "floors", "flooring", "roof", "new",
})


def _norm_dim_for_compare(v: Any, typo_fix_feet: bool = False) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f <= 0:
        return None
    # Foot-mark misread: a walkable opening narrower than 12" (e.g. 4" wide
    # "walkable skylight") is almost certainly feet read as inches.
    if typo_fix_feet and f < 12.0:
        return f * 12.0
    return f


def _looks_walkable(unit: Dict[str, Any]) -> bool:
    if unit.get("is_walkable") is True:
        return True
    blob = " ".join(str(unit.get(k) or "") for k in (
        "location_description", "verbatim", "reasoning", "product_type")).lower()
    return any(t in blob for t in (
        "walkable", "walk-on", "walk on", "glass floor", "glass deck",
        "skylight", "skyfloor"))


def _location_tokens(loc: Any) -> set:
    toks = set(re.findall(r"[a-z0-9]+", str(loc or "").lower()))
    return {t for t in toks if len(t) > 2 and t not in _LOCATION_STOPWORDS}


def _locations_compatible(a: Any, b: Any) -> bool:
    if not a or not b:
        return True
    sa, sb = str(a).lower(), str(b).lower()
    if sa in sb or sb in sa:
        return True
    return bool(_location_tokens(a) & _location_tokens(b))


def _signals_compatible(a: Any, b: Any) -> bool:
    return a is None or b is None or a == b


def _merge_pair(keep: Dict[str, Any], drop: Dict[str, Any]) -> Dict[str, Any]:
    """Fill nulls in keep from drop; combine evidence; never invent values."""
    out = dict(keep)
    for key in ("width_inches", "length_inches", "panel_count", "rafter_count",
                "drawing_number", "location_description", "is_walkable",
                "is_exterior", "product_type", "glass_type", "frame_type"):
        if out.get(key) is None and drop.get(key) is not None:
            out[key] = drop[key]
    for key in ("verbatim", "reasoning"):
        va, vb = out.get(key) or "", drop.get(key) or ""
        if vb and vb not in va:
            out[key] = (va + " | " + vb).strip(" |") if va else vb
    try:
        out["confidence"] = max(int(out.get("confidence") or 0),
                                int(drop.get("confidence") or 0))
    except (TypeError, ValueError):
        pass
    for key in ("citation", "page"):
        if out.get(key) is None and drop.get(key) is not None:
            out[key] = drop[key]
    return out


def deterministic_premerge(raw_units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Collapse entries that are numerically the same physical opening.
    Requires ALL of: both dims present, sorted dims within
    max(1in, 5%) on both axes (after foot-typo normalisation),
    panel_count compatible, walkable/product compatible, locations
    compatible. Returns a new list; never mutates inputs.
    """
    try:
        from extraction.schema_builder import rescue_panel_count_from_verbatim
    except Exception:
        rescue_panel_count_from_verbatim = None  # type: ignore

    units = [dict(u) for u in (raw_units or [])]
    if rescue_panel_count_from_verbatim is not None:
        for u in units:
            if u.get("panel_count") is None:
                rescued = rescue_panel_count_from_verbatim(
                    u.get("verbatim"), u.get("reasoning"))
                if rescued is not None:
                    u["panel_count"] = rescued

    merged: List[Dict[str, Any]] = []
    for cand in units:
        placed = False
        cw = _norm_dim_for_compare(cand.get("width_inches"),
                                   typo_fix_feet=_looks_walkable(cand))
        cl = _norm_dim_for_compare(cand.get("length_inches"),
                                   typo_fix_feet=_looks_walkable(cand))
        if cw is None or cl is None:
            merged.append(cand)
            continue
        c_small, c_large = sorted((cw, cl))
        for i, exist in enumerate(merged):
            ew = _norm_dim_for_compare(exist.get("width_inches"),
                                       typo_fix_feet=_looks_walkable(exist))
            el = _norm_dim_for_compare(exist.get("length_inches"),
                                       typo_fix_feet=_looks_walkable(exist))
            if ew is None or el is None:
                continue
            e_small, e_large = sorted((ew, el))
            if (abs(c_small - e_small) > max(_DIM_TOL_IN, _DIM_TOL_FRAC * e_small)
                    or abs(c_large - e_large) > max(_DIM_TOL_IN, _DIM_TOL_FRAC * e_large)):
                continue
            if not _signals_compatible(cand.get("panel_count"), exist.get("panel_count")):
                continue
            if not _signals_compatible(cand.get("is_walkable"), exist.get("is_walkable")):
                continue
            if not _signals_compatible(cand.get("is_exterior"), exist.get("is_exterior")):
                continue
            if not _signals_compatible(cand.get("product_type"), exist.get("product_type")):
                continue
            if not _locations_compatible(cand.get("location_description"),
                                         exist.get("location_description")):
                continue
            note = ("[deterministic pre-merge] same opening restated "
                    f"({cw}x{cl} vs {ew}x{el} within tolerance)")
            exist_v = exist.get("reasoning") or ""
            merged[i] = _merge_pair(exist, cand)
            merged[i]["reasoning"] = (exist_v + " | " + note).strip(" |") if exist_v else note
            placed = True
            break
        if not placed:
            merged.append(cand)
    return merged


def reconcile_units_with_llm(raw_units: List[Dict[str, Any]], project_id: str) -> List[Dict[str, Any]]:
    """
    Reconciles raw extracted units across multiple documents using Azure OpenAI LLM.
    A deterministic pre-merge first collapses numerically identical openings
    (rounding, unit conversions); the LLM then handles the ambiguous remainder.
    If 0 or 1 unit, returns raw_units directly.
    """
    if not raw_units or len(raw_units) <= 1:
        return raw_units

    try:
        raw_units = deterministic_premerge(raw_units)
    except Exception as e:
        print(f"[WARN] Deterministic pre-merge failed: {e}. Continuing with raw units.")
    if len(raw_units) <= 1:
        return raw_units

    client = get_openai_client()
    user_prompt = f"Project: '{project_id}'\nRaw Extracted Units across project files:\n" + json.dumps(raw_units, indent=2)

    try:
        response = client.chat.completions.create(
            model=AZURE_OPENAI_DEPLOYMENT,
            max_completion_tokens=8000,
            reasoning_effort="medium",
            messages=[
                {"role": "system", "content": RECONCILER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ]
        )
        content = response.choices[0].message.content or ""
        _usage = response.usage
        if _usage:
            token_tracker.track("reconciler", {
                "prompt_tokens": getattr(_usage, "prompt_tokens", 0) or 0,
                "completion_tokens": getattr(_usage, "completion_tokens", 0) or 0,
            })
        # Strip markdown fences if present
        content = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.IGNORECASE)
        content = re.sub(r"\s*```$", "", content, flags=re.IGNORECASE)

        parsed = json.loads(content)
        reconciled = parsed.get("units")
        if isinstance(reconciled, list) and len(reconciled) > 0:
            print(f"[RECONCILER] Successfully merged {len(raw_units)} raw unit entries into {len(reconciled)} consolidated unit(s) for '{project_id}'")
            return reconciled
    except Exception as e:
        print(f"[WARN] LLM Unit Reconciler encountered error: {e}. Falling back to raw units.")

    return raw_units
