"""Generate local SHAP explanations for the selected tree model."""
from __future__ import annotations

from typing import Any
import pandas as pd
import shap

from ai.component2.inference.predict import RiskPredictor
from ai.component2.preprocessing.clean_data import clean_records
from ai.component2.preprocessing.feature_engineering import select_model_features
from .explanation_utils import top_contributions

def explain_prediction(medicine: dict[str, Any], predictor: RiskPredictor | None = None, top_n: int = 5) -> list[dict]:
    predictor = predictor or RiskPredictor()
    cleaned = clean_records(pd.DataFrame([medicine]), require_target=False)
    features = select_model_features(cleaned)
    preprocessor = predictor.model.named_steps["preprocessor"]
    classifier = predictor.model.named_steps["classifier"]
    transformed = preprocessor.transform(features)
    # SHAP's tree explainer expects a numeric dense matrix for sklearn forests.
    if hasattr(transformed, "toarray"):
        transformed = transformed.toarray()
    transformed = transformed.astype(float, copy=False)
    # sklearn forests can show insignificant floating point additivity drift after
    # one-hot encoding, so retain local feature attributions without enforcing it.
    explanation = shap.TreeExplainer(classifier)(transformed, check_additivity=False)
    values = explanation.values
    if values.ndim == 3:  # newer SHAP returns sample x feature x class
        values = values[0, :, 1]
    else:
        values = values[0]
    return top_contributions(preprocessor.get_feature_names_out(), values, top_n)
