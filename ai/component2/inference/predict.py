"""Load the selected model and return a medicine risk prediction."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from ai.component2.preprocessing.clean_data import clean_records
from ai.component2.preprocessing.feature_engineering import select_model_features
from .risk_mapper import risk_level

DEFAULT_MODEL_PATH = Path("ai/component2/models/selected_model/model.joblib")

class RiskPredictor:
    def __init__(self, model_path: str | Path = DEFAULT_MODEL_PATH):
        self.model_path = Path(model_path)
        if not self.model_path.exists():
            raise FileNotFoundError(f"No selected model at {self.model_path}. Train and compare models first.")
        self.model = joblib.load(self.model_path)

    def predict_one(self, medicine: dict[str, Any]) -> dict[str, Any]:
        cleaned = clean_records(pd.DataFrame([medicine]), require_target=False)
        probability = float(self.model.predict_proba(select_model_features(cleaned))[:, 1][0])
        return {"risk_score": round(probability, 6), "risk_level": risk_level(probability)}

def predict_risk(medicine: dict[str, Any], model_path: str | Path = DEFAULT_MODEL_PATH) -> dict[str, Any]:
    return RiskPredictor(model_path).predict_one(medicine)
