from typing import Optional, Any


def compute_rule_confidence(label: str, *signal_confidences) -> Optional[int]:
    """
    Convert a rule certainty label + input signal confidences into a 0-100 integer.
    label: "HIGH" | "MEDIUM" | "LOW" | "MANUAL"
    signal_confidences: extracted_confidence integers or SignalField objects from canonical signals used.
    """
    weights = {"HIGH": 1.0, "MEDIUM": 0.75, "LOW": 0.5}
    if label == "MANUAL" or label not in weights:
        return None

    real = []
    for c in signal_confidences:
        if c is None:
            continue
        if hasattr(c, "extracted_confidence"):
            c = c.extracted_confidence
        elif hasattr(c, "confidence"):
            c = c.confidence
        if isinstance(c, (int, float)) and c >= 0:
            real.append(c)
        elif isinstance(c, str):
            c_upper = c.strip().upper()
            if c_upper == "HIGH":
                real.append(85)
            elif c_upper == "MEDIUM":
                real.append(60)
            elif c_upper == "LOW":
                real.append(30)
            else:
                try:
                    val = float(c_upper)
                    if val >= 0:
                        real.append(val)
                except ValueError:
                    pass

    base = round(sum(real) / len(real)) if real else 70  # 70 = neutral fallback
    return max(0, min(100, round(base * weights[label])))
