"""Tests for reading Component 1 batches through Web3."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest
from web3.exceptions import ContractLogicError

COMPONENT_ROOT = Path(__file__).resolve().parents[1]
if str(COMPONENT_ROOT) not in sys.path:
    sys.path.insert(0, str(COMPONENT_ROOT))

from integrations.traceability_client import (
    TraceabilityClient,
    TraceabilitySettings,
    BatchNotFoundError,
    load_traceability_settings,
)


ADDRESS = "0x0000000000000000000000000000000000000001"


def raw_batch(batch_id: str = "BATCH-001") -> tuple:
    data = (
        batch_id,
        "MED-001",
        "Amoxicillin",
        "Antibiotic",
        "Capsule",
        "500 mg",
        "MediSafe Labs",
        "Bacterial infection",
        "Prescription",
        500,
        1_700_000_000,
        1_900_000_000,
        "ipfs://document",
        "ipfs://certificate",
    )
    return (data, ADDRESS, ADDRESS, 0, False)


class FakeCall:
    def __init__(self, result: Any) -> None:
        self.result = result

    def call(self) -> Any:
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeFunctions:
    def __init__(self, result: Any) -> None:
        self.result = result

    def getBatch(self, batch_id: str) -> FakeCall:
        return FakeCall(self.result)


def client_with_batch(result: Any) -> TraceabilityClient:
    client = TraceabilityClient.__new__(TraceabilityClient)
    client.contract = type(
        "FakeContract", (), {"functions": FakeFunctions(result)}
    )()
    return client


def test_reads_and_maps_registered_batch() -> None:
    payload = client_with_batch(raw_batch()).get_risk_payload("BATCH-001")

    assert payload == {
        "batch_id": "BATCH-001",
        "Name": "Amoxicillin",
        "Category": "Antibiotic",
        "Dosage Form": "Capsule",
        "Strength": "500 mg",
        "Manufacturer": "MediSafe Labs",
        "Indication": "Bacterial infection",
        "Classification": "Prescription",
    }


def test_rejects_mismatched_returned_batch_id() -> None:
    with pytest.raises(RuntimeError, match="mismatched"):
        client_with_batch(raw_batch("OTHER")).get_risk_payload("BATCH-001")


def test_rejects_unexpected_contract_result_shape() -> None:
    with pytest.raises(RuntimeError, match="unexpected batch structure"):
        client_with_batch((("BATCH-001",), ADDRESS)).get_risk_payload("BATCH-001")


def test_translates_missing_contract_batch_to_domain_error() -> None:
    with pytest.raises(BatchNotFoundError, match="BATCH-404"):
        client_with_batch(ContractLogicError("BatchNotFound")).get_risk_payload(
            "BATCH-404"
        )


def test_loads_traceability_address_from_selected_network(tmp_path: Path) -> None:
    path = tmp_path / "addresses.json"
    path.write_text(
        json.dumps({"localhost": {"MedicineTraceability": ADDRESS}}),
        encoding="utf-8",
    )

    settings = load_traceability_settings(
        {"WEB3_RPC_URL": "http://127.0.0.1:8545"}, path
    )

    assert settings == TraceabilitySettings(
        network="localhost",
        chain_id=31337,
        rpc_url="http://127.0.0.1:8545",
        contract_address=ADDRESS,
    )


def test_explicit_traceability_address_overrides_shared_registry() -> None:
    settings = load_traceability_settings(
        {
            "WEB3_RPC_URL": "https://rpc.example.invalid",
            "TRACEABILITY_NETWORK": "sepolia",
            "MEDICINE_TRACEABILITY_ADDRESS": ADDRESS,
        },
        Path("does-not-need-to-exist.json"),
    )

    assert settings.network == "sepolia"
    assert settings.chain_id == 11155111
    assert settings.contract_address == ADDRESS


@pytest.mark.parametrize(
    "env, message",
    [
        ({}, "WEB3_RPC_URL"),
        ({"WEB3_RPC_URL": "http://localhost", "TRACEABILITY_NETWORK": "mainnet"}, "TRACEABILITY_NETWORK"),
        ({"WEB3_RPC_URL": "http://localhost", "MEDICINE_TRACEABILITY_ADDRESS": "invalid"}, "address is missing or invalid"),
    ],
)
def test_rejects_invalid_traceability_configuration(
    env: dict[str, str], message: str
) -> None:
    with pytest.raises(RuntimeError, match=message):
        load_traceability_settings(env, Path("missing.json"))
