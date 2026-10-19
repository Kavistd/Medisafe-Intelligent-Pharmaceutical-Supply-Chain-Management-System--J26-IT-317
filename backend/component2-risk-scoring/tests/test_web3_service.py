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
from blockchain.settings import BlockchainSettings


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
    chain_id = 31337

    def get_transaction_count(self, sender: str) -> int:
        assert sender == SENDER
        return 7

    def get_code(self, address: str) -> bytes:
        return b"\x60\x80"

    def contract(self, address: str, abi: list[dict[str, Any]]) -> Any:
        return type("FakeContract", (), {"address": address, "abi": abi})()


class FakeWeb3:
    eth = FakeEth()

    def is_connected(self) -> bool:
        return True


def registry_client() -> RiskRegistryClient:
    client = RiskRegistryClient.__new__(RiskRegistryClient)
    client.web3 = FakeWeb3()
    client.contract = type("FakeContract", (), {"functions": FakeFunctions()})()
    return client


@pytest.mark.parametrize(
    ("model_score", "registry_score", "is_safe"),
    [
        (0.0, 0, True),
        (0.69, 69, True),
        (0.6949, 69, True),
        (0.695, 70, False),
        (0.699, 70, False),
        (0.70, 70, False),
        (1.0, 100, False),
    ],
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


def settings(chain_id: int = 31337) -> BlockchainSettings:
    return BlockchainSettings(
        network="localhost",
        chain_id=chain_id,
        rpc_url="http://127.0.0.1:8545",
        contract_address=SENDER,
    )


def test_client_verifies_connection_chain_and_deployed_contract() -> None:
    client = RiskRegistryClient(settings=settings(), web3=FakeWeb3())

    assert client.connection_status() == {
        "connected": True,
        "network": "localhost",
        "chain_id": 31337,
        "contract_address": SENDER,
    }


def test_client_rejects_wrong_chain() -> None:
    with pytest.raises(RuntimeError, match="chain ID"):
        RiskRegistryClient(settings=settings(chain_id=11155111), web3=FakeWeb3())


def test_client_rejects_unreachable_rpc() -> None:
    web3 = FakeWeb3()
    web3.is_connected = lambda: False

    with pytest.raises(RuntimeError, match="Unable to connect"):
        RiskRegistryClient(settings=settings(), web3=web3)


def test_client_rejects_address_without_contract_code() -> None:
    web3 = FakeWeb3()
    web3.eth = FakeEth()
    web3.eth.get_code = lambda address: b""

    with pytest.raises(RuntimeError, match="No deployed contract"):
        RiskRegistryClient(settings=settings(), web3=web3)


class ConfirmCall:
    def __init__(self, value: Any) -> None:
        self.value = value

    def call(self) -> Any:
        return self.value


class ConfirmFunctions:
    def hasBatchRisk(self, batch_id: str) -> ConfirmCall:
        return ConfirmCall(True)

    def getRiskScore(self, batch_id: str) -> ConfirmCall:
        return ConfirmCall(82)

    def isBatchSafe(self, batch_id: str) -> ConfirmCall:
        return ConfirmCall(False)


class ConfirmContract:
    functions = ConfirmFunctions()

    def decode_function_input(self, data: str) -> tuple[Any, dict[str, Any]]:
        function = type("Function", (), {"fn_name": "setBatchRisk"})()
        return function, {
            "batchId": "BATCH-001",
            "riskScore": 82,
            "isSafe": False,
        }


class ConfirmEth:
    def wait_for_transaction_receipt(
        self, transaction_hash: str, timeout: int
    ) -> dict[str, Any]:
        return {"status": 1, "blockNumber": 42}

    def get_transaction(self, transaction_hash: str) -> dict[str, Any]:
        return {"to": SENDER, "input": "0x1234"}


def confirmation_client() -> RiskRegistryClient:
    client = RiskRegistryClient.__new__(RiskRegistryClient)
    client.web3 = type("ConfirmWeb3", (), {"eth": ConfirmEth()})()
    client.contract = ConfirmContract()
    client.contract_address = SENDER
    return client


def test_confirms_wallet_transaction_and_registry_state() -> None:
    transaction_hash = f"0x{'a' * 64}"

    result = confirmation_client().confirm_record(
        transaction_hash, "BATCH-001", 0.82
    )

    assert result == {
        "transaction_hash": transaction_hash,
        "block_number": 42,
        "batch_id": "BATCH-001",
        "risk_score": 0.82,
        "score_percent": 82,
        "is_safe": False,
        "confirmed": True,
    }


def test_rejects_confirmation_for_wrong_contract() -> None:
    client = confirmation_client()
    client.web3.eth.get_transaction = lambda transaction_hash: {
        "to": "0x0000000000000000000000000000000000000002",
        "input": "0x1234",
    }

    with pytest.raises(ValueError, match="not sent"):
        client.confirm_record(f"0x{'b' * 64}", "BATCH-001", 0.82)


def test_rejects_reverted_risk_transaction() -> None:
    client = confirmation_client()
    client.web3.eth.wait_for_transaction_receipt = (
        lambda transaction_hash, timeout: {"status": 0, "blockNumber": 42}
    )

    with pytest.raises(ValueError, match="reverted"):
        client.confirm_record(f"0x{'c' * 64}", "BATCH-001", 0.82)


def test_rejects_transaction_with_unexpected_assessment() -> None:
    with pytest.raises(ValueError, match="does not match"):
        confirmation_client().confirm_record(
            f"0x{'d' * 64}", "BATCH-001", 0.21
        )
