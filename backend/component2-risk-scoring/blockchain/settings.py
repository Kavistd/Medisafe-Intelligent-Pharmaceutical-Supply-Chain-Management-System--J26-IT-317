"""Configuration resolution for the Component 2 blockchain connection."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

from web3 import Web3


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_ADDRESSES_PATH = (
    REPOSITORY_ROOT / "shared" / "blockchain" / "contract-addresses.json"
)
SUPPORTED_NETWORKS = {
    "hardhat": 31337,
    "localhost": 31337,
    "sepolia": 11155111,
}


@dataclass(frozen=True)
class BlockchainSettings:
    """Validated connection details without private signing credentials."""

    network: str
    chain_id: int
    contract_address: str
    rpc_url: str = field(repr=False)


def load_blockchain_settings(
    env: Mapping[str, str] | None = None,
    addresses_path: str | Path = DEFAULT_ADDRESSES_PATH,
) -> BlockchainSettings:
    """Resolve RPC, network, and registry address from environment/config.

    ``MEDICINE_RISK_REGISTRY_ADDRESS`` overrides the shared address registry,
    which is useful for temporary deployments. No private key is loaded by the
    API because transaction signing remains the wallet's responsibility.
    """
    values = env if env is not None else os.environ
    network = values.get("RISK_REGISTRY_NETWORK", "localhost").strip().lower()
    if network not in SUPPORTED_NETWORKS:
        raise RuntimeError(
            "RISK_REGISTRY_NETWORK must be hardhat, localhost, or sepolia."
        )

    rpc_url = values.get("WEB3_RPC_URL", "").strip()
    if not rpc_url:
        raise RuntimeError("WEB3_RPC_URL is required for blockchain access.")

    contract_address = values.get("MEDICINE_RISK_REGISTRY_ADDRESS", "").strip()
    if not contract_address:
        contract_address = _address_from_registry(Path(addresses_path), network)
    if not Web3.is_address(contract_address) or contract_address == Web3.to_checksum_address(
        "0x0000000000000000000000000000000000000000"
    ):
        raise RuntimeError(
            "MedicineRiskRegistry address is missing or invalid for the selected network."
        )

    return BlockchainSettings(
        network=network,
        chain_id=SUPPORTED_NETWORKS[network],
        rpc_url=rpc_url,
        contract_address=Web3.to_checksum_address(contract_address),
    )


def _address_from_registry(path: Path, network: str) -> str:
    try:
        registry = json.loads(path.read_text(encoding="utf-8"))
        value = registry[network]["MedicineRiskRegistry"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise RuntimeError(
            "Unable to read MedicineRiskRegistry from shared contract addresses."
        ) from exc
    if not isinstance(value, str):
        raise RuntimeError(
            "MedicineRiskRegistry address is missing or invalid for the selected network."
        )
    return value.strip()
