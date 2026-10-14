"""Unit tests for building risk-registry transactions."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

COMPONENT_ROOT = Path(__file__).resolve().parents[1]
if str(COMPONENT_ROOT) not in sys.path:
    sys.path.insert(0, str(COMPONENT_ROOT))

from blockchain.web3_service import RiskRegistryClient


SENDER = "0x0000000000000000000000000000000000000001"


class FakeTransactionBuilder:
    def __init__(self, call: tuple[str, int, bool]) -> None:
        self.call = call

    def build_transaction(self, options: dict[str, Any]) -> dict[str, Any]:
        return {"call": self.call, **options}


class FakeFunctions:
    def setBatchRisk(
        self, batch_id: str, score: int, is_safe: bool
    ) -> FakeTransactionBuilder:
        return FakeTransactionBuilder((batch_id, score, is_safe))


class FakeEth:
    def get_transaction_count(self, sender: str) -> int:
        assert sender == SENDER
        return 7


class FakeWeb3:
    eth = FakeEth()


def registry_client() -> RiskRegistryClient:
    client = RiskRegistryClient.__new__(RiskRegistryClient)
    client.web3 = FakeWeb3()
    client.contract = type("FakeContract", (), {"functions": FakeFunctions()})()
    return client


@pytest.mark.parametrize(
    ("model_score", "registry_score", "is_safe"),
    [(0.0, 0, True), (0.699, 70, True), (0.70, 70, False), (1.0, 100, False)],
)
def test_build_record_transaction_maps_model_score_to_registry_scale(
    model_score: float, registry_score: int, is_safe: bool
) -> None:
    transaction = registry_client().build_record_transaction(
        "BATCH-001", model_score, SENDER
    )

    assert transaction == {
        "call": ("BATCH-001", registry_score, is_safe),
        "from": SENDER,
        "nonce": 7,
    }


@pytest.mark.parametrize("invalid_score", [-0.01, 1.01])
def test_build_record_transaction_rejects_invalid_score(invalid_score: float) -> None:
    with pytest.raises(ValueError, match="between 0 and 1"):
        registry_client().build_record_transaction(
            "BATCH-001", invalid_score, SENDER
        )
