"""Tests for the Component 1 to Component 2 field boundary."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

COMPONENT_ROOT = Path(__file__).resolve().parents[1]
if str(COMPONENT_ROOT) not in sys.path:
    sys.path.insert(0, str(COMPONENT_ROOT))

from integrations.batch_mapper import map_traceability_batch


def traceability_batch() -> dict:
    return {
        "batchId": " Batch-Case-Sensitive ",
        "medicineId": "MED-001",
        "name": "Amoxicillin",
        "category": "Antibiotic",
        "dosageForm": "Capsule",
        "strength": "500 mg",
        "manufacturerName": "MediSafe Labs",
        "indication": "Bacterial infection",
        "classification": "Prescription",
        "quantity": 500,
        "manufacturedAt": 1_700_000_000,
        "expiresAt": 1_900_000_000,
        "documentReference": "ipfs://document",
        "certificateReference": "ipfs://certificate",
        "owner": "0x0000000000000000000000000000000000000001",
        "recalled": False,
    }


def test_maps_only_approved_model_fields_and_preserves_values() -> None:
    payload = map_traceability_batch(traceability_batch())

    assert payload == {
        "batch_id": " Batch-Case-Sensitive ",
        "Name": "Amoxicillin",
        "Category": "Antibiotic",
        "Dosage Form": "Capsule",
        "Strength": "500 mg",
        "Manufacturer": "MediSafe Labs",
        "Indication": "Bacterial infection",
        "Classification": "Prescription",
    }
    assert "medicineId" not in payload
    assert "documentReference" not in payload
    assert "owner" not in payload


@pytest.mark.parametrize("field", [
    "batchId",
    "name",
    "category",
    "dosageForm",
    "strength",
    "manufacturerName",
    "indication",
    "classification",
])
def test_rejects_missing_or_blank_required_fields(field: str) -> None:
    batch = traceability_batch()
    batch[field] = "   "

    with pytest.raises(ValueError, match=field):
        map_traceability_batch(batch)
