"""Read Component 1 medicine batches from MedicineTraceability."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from web3 import Web3
from web3.exceptions import ContractLogicError

from blockchain.settings import (
    DEFAULT_ADDRESSES_PATH,
    SUPPORTED_NETWORKS,
)
from integrations.batch_mapper import map_traceability_batch


DEFAULT_ABI_PATH = (
    Path(__file__).resolve().parents[3]
    / "shared"
    / "abis"
    / "MedicineTraceability.json"
)
BATCH_DATA_FIELDS = (
    "batchId",
    "medicineId",
    "name",
    "category",
    "dosageForm",
    "strength",
    "manufacturerName",
    "indication",
    "classification",
    "quantity",
    "manufacturedAt",
    "expiresAt",
    "documentReference",
    "certificateReference",
)


class BatchNotFoundError(ValueError):
    """Raised when Component 1 has no readable batch for an identifier."""


@dataclass(frozen=True)
class TraceabilitySettings:
    network: str
    chain_id: int
    contract_address: str
    rpc_url: str = field(repr=False)


def load_traceability_settings(
    env: Mapping[str, str] | None = None,
    addresses_path: str | Path = DEFAULT_ADDRESSES_PATH,
) -> TraceabilitySettings:
    values = env if env is not None else os.environ
    network = values.get(
        "TRACEABILITY_NETWORK",
        values.get("RISK_REGISTRY_NETWORK", "localhost"),
    ).strip().lower()
    if network not in SUPPORTED_NETWORKS:
        raise RuntimeError(
            "TRACEABILITY_NETWORK must be hardhat, localhost, or sepolia."
        )
    rpc_url = values.get("WEB3_RPC_URL", "").strip()
    if not rpc_url:
        raise RuntimeError("WEB3_RPC_URL is required for traceability access.")

    contract_address = values.get("MEDICINE_TRACEABILITY_ADDRESS", "").strip()
    if not contract_address:
        contract_address = _configured_address(Path(addresses_path), network)
    if not Web3.is_address(contract_address) or int(contract_address, 16) == 0:
        raise RuntimeError(
            "MedicineTraceability address is missing or invalid for the selected network."
        )
    return TraceabilitySettings(
        network=network,
        chain_id=SUPPORTED_NETWORKS[network],
        rpc_url=rpc_url,
        contract_address=Web3.to_checksum_address(contract_address),
    )


def _configured_address(path: Path, network: str) -> str:
    try:
        registry = json.loads(path.read_text(encoding="utf-8"))
        value = registry[network]["MedicineTraceability"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise RuntimeError(
            "Unable to read MedicineTraceability from shared contract addresses."
        ) from exc
    return value.strip() if isinstance(value, str) else ""


class TraceabilityClient:
    """Read and map registered Component 1 batches without signing."""

    def __init__(
        self,
        settings: TraceabilitySettings | None = None,
        web3: Web3 | None = None,
        abi_path: str | Path = DEFAULT_ABI_PATH,
    ) -> None:
        resolved = settings or load_traceability_settings()
        self.web3 = web3 or Web3(Web3.HTTPProvider(resolved.rpc_url))
        if not self.web3.is_connected():
            raise RuntimeError("Unable to connect to WEB3_RPC_URL.")
        if int(self.web3.eth.chain_id) != resolved.chain_id:
            raise RuntimeError(
                "Connected chain ID does not match TRACEABILITY_NETWORK."
            )
        if not self.web3.eth.get_code(resolved.contract_address):
            raise RuntimeError(
                "No deployed contract found at MedicineTraceability address."
            )

        artifact = json.loads(Path(abi_path).read_text(encoding="utf-8"))
        abi = artifact["abi"] if isinstance(artifact, dict) else artifact
        self.contract = self.web3.eth.contract(
            address=resolved.contract_address,
            abi=abi,
        )

    def get_risk_payload(self, batch_id: str) -> dict[str, str]:
        if not isinstance(batch_id, str) or not batch_id.strip():
            raise ValueError("batch_id is required")
        try:
            raw_batch = self.contract.functions.getBatch(batch_id).call()
        except ContractLogicError as exc:
            raise BatchNotFoundError(
                f"Component 1 batch '{batch_id}' was not found."
            ) from exc

        batch = self._decode_batch(raw_batch)
        if batch["batchId"] != batch_id:
            raise RuntimeError("Component 1 returned a mismatched batch identifier.")
        return map_traceability_batch(batch)

    @staticmethod
    def _decode_batch(raw_batch: Any) -> dict[str, Any]:
        try:
            raw_data = raw_batch[0]
            if len(raw_data) != len(BATCH_DATA_FIELDS):
                raise ValueError
            batch = dict(zip(BATCH_DATA_FIELDS, raw_data))
            batch.update(
                {
                    "manufacturer": raw_batch[1],
                    "owner": raw_batch[2],
                    "stage": raw_batch[3],
                    "recalled": raw_batch[4],
                }
            )
            return batch
        except (IndexError, TypeError, ValueError) as exc:
            raise RuntimeError(
                "MedicineTraceability returned an unexpected batch structure."
            ) from exc
