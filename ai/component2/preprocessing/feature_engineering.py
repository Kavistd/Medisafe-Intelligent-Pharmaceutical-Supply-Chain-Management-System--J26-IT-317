"""Feature helpers used consistently in model training and inference."""
from __future__ import annotations

import pandas as pd

from .clean_data import MODEL_FEATURES


def select_model_features(records: pd.DataFrame) -> pd.DataFrame:
    """Select approved model features only; metadata and labels never enter the model."""
    missing = sorted(set(MODEL_FEATURES) - set(records.columns))
    if missing:
        raise ValueError(f"Features were not prepared: {', '.join(missing)}")
    return records.loc[:, MODEL_FEATURES].copy()
