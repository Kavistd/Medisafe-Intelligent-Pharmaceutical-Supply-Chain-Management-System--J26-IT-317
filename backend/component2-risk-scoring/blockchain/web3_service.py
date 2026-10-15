"""Web3 helper for building MedicineRiskRegistry transactions."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from web3 import Web3

from blockchain.settings import BlockchainSettings, load_blockchain_settings


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
        settings: BlockchainSettings | None = None,
        web3: Web3 | None = None,
    ) -> None:
        resolved_settings = settings or self._settings_with_overrides(rpc_url, address)
        self.web3 = web3 or Web3(Web3.HTTPProvider(resolved_settings.rpc_url))
        if not self.web3.is_connected():
            raise RuntimeError("Unable to connect to WEB3_RPC_URL.")

        actual_chain_id = int(self.web3.eth.chain_id)
        if actual_chain_id != resolved_settings.chain_id:
            raise RuntimeError(
                "Connected chain ID does not match RISK_REGISTRY_NETWORK."
            )

        contract_address = resolved_settings.contract_address
        if not self.web3.eth.get_code(contract_address):
            raise RuntimeError(
                "No deployed contract found at MedicineRiskRegistry address."
            )

        abi = json.loads(Path(abi_path).read_text(encoding="utf-8"))
        self.contract = self.web3.eth.contract(
            address=contract_address,
            abi=abi,
        )
        self.network = resolved_settings.network
        self.chain_id = resolved_settings.chain_id
        self.contract_address = contract_address

    @staticmethod
    def _settings_with_overrides(
        rpc_url: str | None, address: str | None
    ) -> BlockchainSettings:
        env = dict(os.environ)
        if rpc_url is not None:
            env["WEB3_RPC_URL"] = rpc_url
        if address is not None:
            env["MEDICINE_RISK_REGISTRY_ADDRESS"] = address
        return load_blockchain_settings(env)

    def connection_status(self) -> dict[str, Any]:
        """Return non-secret readiness details for health checks."""
        return {
            "connected": True,
            "network": self.network,
            "chain_id": self.chain_id,
            "contract_address": self.contract_address,
        }

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
