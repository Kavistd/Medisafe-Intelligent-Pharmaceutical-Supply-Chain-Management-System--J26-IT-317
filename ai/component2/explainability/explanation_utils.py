"""Helpers for safe, compact explanations returned by the API."""
from __future__ import annotations

def format_feature_name(feature: str) -> str:
    return feature.replace("categorical__", "").replace("numerical__", "").replace("_", " ")

def top_contributions(feature_names, values, limit: int = 5) -> list[dict]:
    ranked = sorted(zip(feature_names, values), key=lambda row: abs(float(row[1])), reverse=True)[:limit]
    return [{"feature": format_feature_name(name), "contribution": round(float(value), 6), "direction": "increases risk" if value > 0 else "reduces risk"} for name, value in ranked]
