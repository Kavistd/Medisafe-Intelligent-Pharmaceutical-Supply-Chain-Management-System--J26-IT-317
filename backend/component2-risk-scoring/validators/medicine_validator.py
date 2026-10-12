"""Validation helpers shared by API and integration callers."""
from __future__ import annotations

REQUIRED_MEDICINE_FIELDS = {
    "batch_id", "Name", "Category", "Dosage Form", "Strength",
    "Manufacturer", "Indication", "Classification",
}


def validate_medicine_payload(payload: dict) -> None:
    missing = sorted(field for field in REQUIRED_MEDICINE_FIELDS if not str(payload.get(field, "")).strip())
    if missing:
        raise ValueError(f"Missing required medicine fields: {', '.join(missing)}")
