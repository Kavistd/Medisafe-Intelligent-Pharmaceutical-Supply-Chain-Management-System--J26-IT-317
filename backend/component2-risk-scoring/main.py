"""Runnable FastAPI application for the Component 2 risk-scoring service."""
from __future__ import annotations

from fastapi import FastAPI

from api.risk_routes import router as risk_router

app = FastAPI(
    title="MediSafe Chain - Medicine Risk Scoring API",
    version="1.0.0",
    description="Explainable AI risk assessments for medicine batches.",
)
app.include_router(risk_router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "component2-risk-scoring"}
