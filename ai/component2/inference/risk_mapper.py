"""Maps numerical risk probabilities to user-facing risk levels."""
from __future__ import annotations

def risk_level(score: float) -> str:
    if not 0 <= float(score) <= 1:
        raise ValueError("Risk score must be between 0 and 1")
    if score < 0.40:
        return "Low"
    if score < 0.70:
        return "Medium"
    return "High"
