"""Integration tests for the Component 2 FastAPI endpoints."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

COMPONENT_ROOT = Path(__file__).resolve().parents[1]
if str(COMPONENT_ROOT) not in sys.path:
    sys.path.insert(0, str(COMPONENT_ROOT))

import api.risk_routes as risk_routes
import main as main_module
from main import app


client = TestClient(app)


def valid_payload() -> dict[str, str]:
    return {
        "batch_id": "BATCH-001",
        "Name": "Cefvir",
        "Category": "Antiseptic",
        "Dosage Form": "Injection",
        "Strength": "419 mg",
        "Manufacturer": "GlaxoSmithKline plc",
        "Indication": "Virus",
        "Classification": "Over-the-Counter",
    }


def test_health_endpoint_reports_component_status() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "component2-risk-scoring",
    }


def test_blockchain_health_reports_verified_connection(monkeypatch: Any) -> None:
    class ConnectedRegistryClient:
        def connection_status(self) -> dict[str, Any]:
            return {
                "connected": True,
                "network": "localhost",
                "chain_id": 31337,
                "contract_address": "0x0000000000000000000000000000000000000001",
            }

    monkeypatch.setattr(main_module, "RiskRegistryClient", ConnectedRegistryClient)

    response = client.get("/health/blockchain")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "connected": True,
        "network": "localhost",
        "chain_id": 31337,
        "contract_address": "0x0000000000000000000000000000000000000001",
    }


def test_blockchain_health_reports_unavailable_configuration(monkeypatch: Any) -> None:
    class UnavailableRegistryClient:
        def __init__(self) -> None:
            raise RuntimeError("WEB3_RPC_URL is required for blockchain access.")

    monkeypatch.setattr(main_module, "RiskRegistryClient", UnavailableRegistryClient)

    response = client.get("/health/blockchain")

    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "detail": "WEB3_RPC_URL is required for blockchain access.",
    }


def test_assess_endpoint_returns_risk_result(monkeypatch: Any) -> None:
    expected = {
        "batch_id": "BATCH-001",
        "risk_score": 0.82,
        "risk_level": "High",
        "explanation": [{"feature": "Strength", "impact": 0.31}],
    }

    class StubRiskService:
        def assess(self, medicine: dict[str, Any]) -> dict[str, Any]:
            assert medicine == valid_payload()
            return expected

    monkeypatch.setattr(risk_routes, "RiskService", StubRiskService)

    response = client.post("/api/v1/risk/assess", json=valid_payload())

    assert response.status_code == 200
    assert response.json() == expected


def test_assess_endpoint_rejects_missing_required_input() -> None:
    payload = valid_payload()
    del payload["Manufacturer"]

    response = client.post("/api/v1/risk/assess", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "Manufacturer"]


def test_transaction_endpoint_returns_assessment_and_unsigned_transaction(
    monkeypatch: Any,
) -> None:
    assessment = {
        "batch_id": "BATCH-001",
        "risk_score": 0.82,
        "risk_level": "High",
        "explanation": [],
    }
    transaction = {
        "from": "0x0000000000000000000000000000000000000001",
        "to": "0x0000000000000000000000000000000000000002",
        "nonce": 4,
        "data": "0x1234",
    }

    class StubRiskService:
        def assess(self, medicine: dict[str, Any]) -> dict[str, Any]:
            assert medicine == valid_payload()
            return assessment

    class StubRegistryClient:
        def build_record_transaction(
            self, batch_id: str, risk_score: float, sender: str
        ) -> dict[str, Any]:
            assert batch_id == "BATCH-001"
            assert risk_score == 0.82
            assert sender == "0x0000000000000000000000000000000000000001"
            return transaction

    monkeypatch.setattr(risk_routes, "RiskService", StubRiskService)
    monkeypatch.setattr(risk_routes, "RiskRegistryClient", StubRegistryClient)

    payload = {
        **valid_payload(),
        "sender": "0x0000000000000000000000000000000000000001",
    }
    response = client.post("/api/v1/risk/assess/transaction", json=payload)

    assert response.status_code == 200
    assert response.json() == {
        "assessment": assessment,
        "transaction": transaction,
    }


def test_transaction_endpoint_reports_missing_blockchain_configuration(
    monkeypatch: Any,
) -> None:
    class StubRiskService:
        def assess(self, medicine: dict[str, Any]) -> dict[str, Any]:
            return {"risk_score": 0.2}

    class UnconfiguredRegistryClient:
        def __init__(self) -> None:
            raise RuntimeError("blockchain configuration is missing")

    monkeypatch.setattr(risk_routes, "RiskService", StubRiskService)
    monkeypatch.setattr(risk_routes, "RiskRegistryClient", UnconfiguredRegistryClient)

    payload = {
        **valid_payload(),
        "sender": "0x0000000000000000000000000000000000000001",
    }
    response = client.post("/api/v1/risk/assess/transaction", json=payload)

    assert response.status_code == 503
    assert response.json() == {"detail": "blockchain configuration is missing"}
