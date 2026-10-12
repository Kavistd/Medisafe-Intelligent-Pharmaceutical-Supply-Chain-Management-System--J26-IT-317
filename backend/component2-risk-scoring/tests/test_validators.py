"""Unit tests for Component 2 input validation and risk bands."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

COMPONENT_ROOT = Path(__file__).resolve().parents[1]
if str(COMPONENT_ROOT) not in sys.path:
    sys.path.insert(0, str(COMPONENT_ROOT))

from validators.medicine_validator import validate_medicine_payload
from ai.component2.inference.risk_mapper import risk_level


def valid_payload() -> dict:
    return {
        "batch_id": "BATCH-001", "Name": "Cefvir", "Category": "Antiseptic",
        "Dosage Form": "Injection", "Strength": "419 mg",
        "Manufacturer": "GlaxoSmithKline plc", "Indication": "Virus",
        "Classification": "Over-the-Counter",
    }


def test_valid_payload_is_accepted() -> None:
    validate_medicine_payload(valid_payload())


def test_missing_required_field_is_rejected() -> None:
    payload = valid_payload()
    del payload["Manufacturer"]
    with pytest.raises(ValueError, match="Manufacturer"):
        validate_medicine_payload(payload)


@pytest.mark.parametrize(("score", "expected"), [(0.0, "Low"), (0.39, "Low"), (0.4, "Medium"), (0.69, "Medium"), (0.7, "High"), (1.0, "High")])
def test_risk_bands(score: float, expected: str) -> None:
    assert risk_level(score) == expected
