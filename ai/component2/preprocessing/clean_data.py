"""Clean and validate medicine records without using label-leaking fields."""
from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Iterable

import pandas as pd

RAW_FEATURES = ["Name", "Category", "Dosage Form", "Strength", "Manufacturer", "Indication", "Classification"]
MODEL_FEATURES = ["Name", "Category", "Dosage Form", "Manufacturer", "Indication", "Classification", "strength_mg", "log_strength_mg"]
TARGET_COLUMN = "is_anomalous"
LEAKAGE_COLUMNS = {"record_id", "data_origin", "anomaly_type", "anomaly_fields", "synthetic_anomaly_score"}


def parse_strength_mg(value: object) -> float:
    """Convert strengths such as ``500 mg`` or ``0.5 g`` to milligrams."""
    if value is None or pd.isna(value):
        return float("nan")
    match = re.search(r"([-+]?[0-9]*\.?[0-9]+)\s*(mcg|µg|ug|mg|g|kg)?", str(value).lower())
    if not match:
        return float("nan")
    amount = float(match.group(1))
    unit = match.group(2) or "mg"
    multiplier = {"mcg": 0.001, "µg": 0.001, "ug": 0.001, "mg": 1.0, "g": 1000.0, "kg": 1_000_000.0}[unit]
    return amount * multiplier


def clean_records(records: pd.DataFrame, require_target: bool = False) -> pd.DataFrame:
    """Return model-safe, normalised records and retain only valid required fields."""
    required = list(RAW_FEATURES)
    if require_target:
        required.append(TARGET_COLUMN)
    missing = sorted(set(required) - set(records.columns))
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    cleaned = records.copy()
    for column in RAW_FEATURES:
        cleaned[column] = cleaned[column].fillna("Unknown").astype(str).str.strip()
        cleaned.loc[cleaned[column].eq(""), column] = "Unknown"
    cleaned["strength_mg"] = cleaned["Strength"].map(parse_strength_mg)
    median_strength = cleaned["strength_mg"].dropna().median()
    cleaned["strength_mg"] = cleaned["strength_mg"].fillna(median_strength if pd.notna(median_strength) else 0.0).clip(lower=0)
    cleaned["log_strength_mg"] = cleaned["strength_mg"].map(math.log1p)
    if require_target:
        cleaned[TARGET_COLUMN] = pd.to_numeric(cleaned[TARGET_COLUMN], errors="raise").astype(int)
        if not cleaned[TARGET_COLUMN].isin([0, 1]).all():
            raise ValueError("is_anomalous must contain only 0 and 1")
    return cleaned


def load_training_data(path: str | Path) -> pd.DataFrame:
    """Load the CSV and apply all safe cleaning operations."""
    return clean_records(pd.read_csv(path), require_target=True)
