"""
Lightweight per-run API call tracker.
Call track(call_type, usage) after every API response.
Call summary() at end of pipeline to print full breakdown.
"""
from collections import defaultdict
import threading

_lock = threading.Lock()

_calls: list = []   # list of {"type": str, "input": int, "output": int}

CALL_TYPES = {
    "classifier":   "Classifier        (per drawing page)",
    "vision":       "Vision extraction (drawing pages)",
    "text":         "Text extraction   (lead sheets/text)",
    "reconciler":   "Unit reconciler   (per-doc merge)",
    "schema":       "Schema merger     (LLM revision)",
    "dimension":    "Dimension rescue  (fallback)",
    "teams":        "Teams worker      (chat)",
}

def track(call_type: str, usage: dict):
    if not usage:
        return
    inp = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
    out = usage.get("completion_tokens") or usage.get("output_tokens") or 0
    with _lock:
        _calls.append({"type": call_type, "input": inp, "output": out})

def reset():
    with _lock:
        _calls.clear()

def summary():
    with _lock:
        calls = list(_calls)

    if not calls:
        return

    by_type = defaultdict(lambda: {"count": 0, "input": 0, "output": 0})
    for c in calls:
        t = c["type"]
        by_type[t]["count"]  += 1
        by_type[t]["input"]  += c["input"]
        by_type[t]["output"] += c["output"]

    total_in  = sum(c["input"]  for c in calls)
    total_out = sum(c["output"] for c in calls)

    print(f"\n{'='*70}")
    print("  GFS-AI API CALL BREAKDOWN")
    print(f"{'='*70}")
    print(f"  {'Call Type':<40} {'Calls':>5} {'Input':>8} {'Output':>8} {'Total':>8}")
    print(f"  {'-'*40} {'-'*5} {'-'*8} {'-'*8} {'-'*8}")
    for t, d in sorted(by_type.items()):
        label = CALL_TYPES.get(t, t)
        print(f"  {label:<40} {d['count']:>5} {d['input']:>8,} {d['output']:>8,} {d['input']+d['output']:>8,}")
    print(f"  {'-'*40} {'-'*5} {'-'*8} {'-'*8} {'-'*8}")
    print(f"  {'TOTAL':<40} {len(calls):>5} {total_in:>8,} {total_out:>8,} {total_in+total_out:>8,}")
    print(f"{'='*70}")
