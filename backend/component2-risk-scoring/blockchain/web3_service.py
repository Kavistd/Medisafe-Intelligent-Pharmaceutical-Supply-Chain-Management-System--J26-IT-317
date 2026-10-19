"""Web3 helper for building MedicineRiskRegistry transactions."""
from __future__ import annotations

import json
import os
import re
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
        use an integer percentage from 0 to 100. Safety is derived from the
        rounded integer score to match Component 4's 70-point boundary.
        """
        if not batch_id.strip():
            raise ValueError("batch_id is required")

        checksum_sender = Web3.to_checksum_address(sender)
        score_percent, is_safe = self._registry_values(risk_score)
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

    def confirm_record(
        self,
        transaction_hash: str,
        batch_id: str,
        risk_score: float,
        timeout: int = 120,
    ) -> dict[str, Any]:
        """Confirm a wallet-submitted risk transaction and its stored state."""
        if not re.fullmatch(r"0x[0-9a-fA-F]{64}", transaction_hash or ""):
            raise ValueError("transaction_hash must be a 32-byte hex value")
        if not batch_id.strip():
            raise ValueError("batch_id is required")
        expected_score, expected_safe = self._registry_values(risk_score)

        try:
            receipt = self.web3.eth.wait_for_transaction_receipt(
                transaction_hash, timeout=timeout
            )
            transaction = self.web3.eth.get_transaction(transaction_hash)
        except Exception as exc:
            raise RuntimeError(
                "Unable to confirm the risk registry transaction."
            ) from exc

        if int(self._value(receipt, "status")) != 1:
            raise ValueError("Risk registry transaction reverted.")
        destination = self._value(transaction, "to")
        if not destination or Web3.to_checksum_address(destination) != self.contract_address:
            raise ValueError("Transaction was not sent to MedicineRiskRegistry.")

        function, arguments = self.contract.decode_function_input(
            self._value(transaction, "input")
        )
        if function.fn_name != "setBatchRisk" or arguments != {
            "batchId": batch_id,
            "riskScore": expected_score,
            "isSafe": expected_safe,
        }:
            raise ValueError("Transaction does not match the expected risk assessment.")

        assessed = self.contract.functions.hasBatchRisk(batch_id).call()
        stored_score = int(self.contract.functions.getRiskScore(batch_id).call())
        stored_safe = bool(self.contract.functions.isBatchSafe(batch_id).call())
        if not assessed or stored_score != expected_score or stored_safe != expected_safe:
            raise RuntimeError("Confirmed transaction does not match registry state.")

        return {
            "transaction_hash": transaction_hash,
            "block_number": int(self._value(receipt, "blockNumber")),
            "batch_id": batch_id,
            "risk_score": stored_score / 100,
            "score_percent": stored_score,
            "is_safe": stored_safe,
            "confirmed": True,
        }

    @staticmethod
    def _registry_values(risk_score: float) -> tuple[int, bool]:
        normalized_score = float(risk_score)
        if not 0 <= normalized_score <= 1:
            raise ValueError("risk_score must be between 0 and 1")
        score_percent = round(normalized_score * 100)
        return score_percent, score_percent < 70

    @staticmethod
    def _value(value: Any, key: str) -> Any:
        return value[key] if isinstance(value, dict) else getattr(value, key)
