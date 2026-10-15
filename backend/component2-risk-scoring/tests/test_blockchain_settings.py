"""Tests for Component 2 blockchain configuration resolution."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

COMPONENT_ROOT = Path(__file__).resolve().parents[1]
if str(COMPONENT_ROOT) not in sys.path:
    sys.path.insert(0, str(COMPONENT_ROOT))

from blockchain.settings import load_blockchain_settings


ADDRESS = "0x0000000000000000000000000000000000000001"


def address_registry(tmp_path: Path, value: str = ADDRESS) -> Path:
    path = tmp_path / "addresses.json"
    path.write_text(
        json.dumps(
            {
                "localhost": {"MedicineRiskRegistry": value},
                "sepolia": {"MedicineRiskRegistry": value},
            }
        ),
        encoding="utf-8",
    )
    return path


def test_loads_address_for_selected_network(tmp_path: Path) -> None:
    settings = load_blockchain_settings(
        {
            "WEB3_RPC_URL": "http://127.0.0.1:8545",
            "RISK_REGISTRY_NETWORK": "localhost",
        },
        address_registry(tmp_path),
    )

    assert settings.network == "localhost"
    assert settings.chain_id == 31337
    assert settings.rpc_url == "http://127.0.0.1:8545"
    assert settings.contract_address == ADDRESS


def test_explicit_contract_address_overrides_registry(tmp_path: Path) -> None:
    override = "0x0000000000000000000000000000000000000002"
    settings = load_blockchain_settings(
        {
            "WEB3_RPC_URL": "https://rpc.example.invalid",
            "RISK_REGISTRY_NETWORK": "sepolia",
            "MEDICINE_RISK_REGISTRY_ADDRESS": override,
        },
        address_registry(tmp_path),
    )

    assert settings.chain_id == 11155111
    assert settings.contract_address == override


def test_rpc_url_is_not_exposed_by_settings_repr(tmp_path: Path) -> None:
    settings = load_blockchain_settings(
        {"WEB3_RPC_URL": "https://user:secret@example.invalid"},
        address_registry(tmp_path),
    )

    assert "secret" not in repr(settings)


@pytest.mark.parametrize("network", ["mainnet", "unknown", ""])
def test_rejects_unsupported_network(network: str, tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="RISK_REGISTRY_NETWORK"):
        load_blockchain_settings(
            {"WEB3_RPC_URL": "http://127.0.0.1:8545", "RISK_REGISTRY_NETWORK": network},
            address_registry(tmp_path),
        )


def test_rejects_missing_rpc_url(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="WEB3_RPC_URL"):
        load_blockchain_settings({}, address_registry(tmp_path))


@pytest.mark.parametrize("address", ["", "invalid", "0x0000000000000000000000000000000000000000"])
def test_rejects_missing_or_invalid_contract_address(
    address: str, tmp_path: Path
) -> None:
    with pytest.raises(RuntimeError, match="address is missing or invalid"):
        load_blockchain_settings(
            {"WEB3_RPC_URL": "http://127.0.0.1:8545"},
            address_registry(tmp_path, address),
        )
