"""Web3 helper for publishing auditable risk results to Ethereum."""
from __future__ import annotations
import json, os
from pathlib import Path
from web3 import Web3

class RiskRegistryClient:
    def __init__(self, rpc_url: str | None = None, address: str | None = None, abi_path: str | Path = "shared/blockchain/abi/MedicineRiskRegistry.json"):
        self.web3 = Web3(Web3.HTTPProvider(rpc_url or os.environ.get("WEB3_RPC_URL")))
        contract_address = address or os.environ.get("MEDICINE_RISK_REGISTRY_ADDRESS")
        if not self.web3.is_connected() or not contract_address:
            raise RuntimeError("Set WEB3_RPC_URL and MEDICINE_RISK_REGISTRY_ADDRESS before publishing risk scores.")
        abi = json.loads(Path(abi_path).read_text(encoding="utf-8"))
        self.contract = self.web3.eth.contract(address=Web3.to_checksum_address(contract_address), abi=abi)

    def build_record_transaction(self, batch_id: str, risk_score: float, explanation_hash: str, sender: str) -> dict:
        score_bps = round(float(risk_score) * 10_000)
        return self.contract.functions.recordRisk(batch_id, score_bps, explanation_hash).build_transaction({"from": Web3.to_checksum_address(sender), "nonce": self.web3.eth.get_transaction_count(Web3.to_checksum_address(sender))})
