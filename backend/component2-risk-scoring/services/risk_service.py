"""Application service for prediction, explanation and optional on-chain publishing."""
from __future__ import annotations
from typing import Any

from ai.component2.explainability.shap_explainer import explain_prediction
from ai.component2.inference.predict import RiskPredictor
from validators.medicine_validator import validate_medicine_payload

class RiskService:
    def __init__(self, predictor: RiskPredictor | None = None):
        self.predictor = predictor or RiskPredictor()

    def assess(self, medicine: dict[str, Any], include_explanation: bool = True) -> dict[str, Any]:
        validate_medicine_payload(medicine)
        result = self.predictor.predict_one(medicine)
        if medicine.get("batch_id"):
            result["batch_id"] = str(medicine["batch_id"])
        result["explanation"] = explain_prediction(medicine, self.predictor) if include_explanation else []
        return result
