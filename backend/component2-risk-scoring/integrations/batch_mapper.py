"""Map Component 1 traceability records to Component 2 model inputs."""
from __future__ import annotations

from typing import Any, Mapping


FIELD_MAPPING = {
    "batchId": "batch_id",
    "name": "Name",
    "category": "Category",
    "dosageForm": "Dosage Form",
    "strength": "Strength",
    "manufacturerName": "Manufacturer",
    "indication": "Indication",
    "classification": "Classification",
}


def map_traceability_batch(batch_data: Mapping[str, Any]) -> dict[str, str]:
    """Return the allow-listed risk payload from a Component 1 batch.

    Identifiers are preserved exactly. Operational fields such as quantity,
    custody, IPFS references, and timestamps are deliberately excluded because
    they are not model features in the Component 1 → Component 2 contract.
    """
    payload: dict[str, str] = {}
    for source, target in FIELD_MAPPING.items():
        value = batch_data.get(source)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(
                f"Component 1 batch field '{source}' is missing or blank."
            )
        payload[target] = value
    return payload
