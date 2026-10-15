"""Web3 helper for building MedicineRiskRegistry transactions."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from web3 import Web3


DEFAULT_ABI_PATH = (
    Path(__file__).resolve().parents[3]
    / "shared"
    / "blockchain"
    / "abi"
    / "MedicineRiskRegistry.json"
)


class RiskRegistryClient:
    """Build unsigned transactions for the deployed risk registry."""

    def __init__(
        self,
        rpc_url: str | None = None,
        address: str | None = None,
        abi_path: str | Path = DEFAULT_ABI_PATH,
    ) -> None:
        resolved_rpc_url = rpc_url or os.environ.get("WEB3_RPC_URL")
        contract_address = address or os.environ.get("MEDICINE_RISK_REGISTRY_ADDRESS")
        if not resolved_rpc_url or not contract_address:
            raise RuntimeError(
                "Set WEB3_RPC_URL and MEDICINE_RISK_REGISTRY_ADDRESS before "
                "building risk transactions."
            )

        self.web3 = Web3(Web3.HTTPProvider(resolved_rpc_url))
        if not self.web3.is_connected():
            raise RuntimeError("Unable to connect to WEB3_RPC_URL.")

        abi = json.loads(Path(abi_path).read_text(encoding="utf-8"))
        self.contract = self.web3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=abi,
        )

    def build_record_transaction(
        self,
        batch_id: str,
        risk_score: float,
        sender: str,
    ) -> dict[str, Any]:
        """Build an unsigned ``setBatchRisk`` transaction.

        The model emits a score from 0 to 1, while the registry and Component 4
        use an integer percentage from 0 to 100. High-risk batches are marked
        unsafe using the model's 0.70 risk-band boundary.
        """
        normalized_score = float(risk_score)
        if not 0 <= normalized_score <= 1:
            raise ValueError("risk_score must be between 0 and 1")
        if not batch_id.strip():
            raise ValueError("batch_id is required")

        checksum_sender = Web3.to_checksum_address(sender)
        score_percent = round(normalized_score * 100)
        is_safe = normalized_score < 0.70
        transaction = self.contract.functions.setBatchRisk(
            batch_id,
            score_percent,
            is_safe,
        ).build_transaction(
            {
                "from": checksum_sender,
                "nonce": self.web3.eth.get_transaction_count(checksum_sender),
            }
        )
        return {
            key: Web3.to_hex(value) if isinstance(value, bytes) else value
            for key, value in transaction.items()
        }
