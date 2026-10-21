"""Runnable FastAPI application for the Component 2 risk-scoring service."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Response, status

from api.risk_routes import router as risk_router
from blockchain.web3_service import RiskRegistryClient
from database.client import connection_status as database_connection_status

app = FastAPI(
    title="MediSafe Chain - Medicine Risk Scoring API",
    version="1.0.0",
    description="Explainable AI risk assessments for medicine batches.",
)
app.include_router(risk_router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "component2-risk-scoring"}


@app.get("/health/blockchain", tags=["health"])
def blockchain_health(response: Response) -> dict[str, Any]:
    """Verify RPC connectivity, chain identity, and deployed registry code."""
    try:
        return {"status": "ok", **RiskRegistryClient().connection_status()}
    except RuntimeError as exc:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable", "detail": str(exc)}


@app.get("/health/database", tags=["health"])
def database_health(response: Response) -> dict[str, Any]:
    """Verify the configured PostgreSQL connection without exposing secrets."""
    try:
        return {"status": "ok", **database_connection_status()}
    except RuntimeError as exc:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable", "detail": str(exc)}
