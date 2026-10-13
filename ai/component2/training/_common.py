"""Shared training mechanics."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from ai.component2.preprocessing.clean_data import TARGET_COLUMN, load_training_data
from ai.component2.preprocessing.encode_features import build_preprocessor
from ai.component2.preprocessing.feature_engineering import select_model_features


def data_split(dataset_path: str | Path, test_size: float = 0.15, validation_size: float = 0.15):
    data = load_training_data(dataset_path)
    features, target = select_model_features(data), data[TARGET_COLUMN]
    x_train, x_temp, y_train, y_temp = train_test_split(features, target, test_size=test_size + validation_size, random_state=42, stratify=target)
    test_ratio_of_temp = test_size / (test_size + validation_size)
    x_validation, x_test, y_validation, y_test = train_test_split(x_temp, y_temp, test_size=test_ratio_of_temp, random_state=42, stratify=y_temp)
    return x_train, x_validation, x_test, y_train, y_validation, y_test


def metrics_for(model, features, target) -> dict[str, float]:
    probability = model.predict_proba(features)[:, 1]
    predicted = (probability >= 0.5).astype(int)
    return {"accuracy": float(accuracy_score(target, predicted)), "precision": float(precision_score(target, predicted, zero_division=0)), "recall": float(recall_score(target, predicted, zero_division=0)), "f1": float(f1_score(target, predicted, zero_division=0)), "roc_auc": float(roc_auc_score(target, probability))}


def train_and_save(model, model_name: str, dataset_path: str | Path, output_dir: str | Path) -> dict:
    x_train, x_validation, x_test, y_train, y_validation, y_test = data_split(dataset_path)
    pipeline = Pipeline([("preprocessor", build_preprocessor()), ("classifier", model)])
    pipeline.fit(x_train, y_train)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, output / "model.joblib")
    report = {"model": model_name, "created_at": datetime.now(timezone.utc).isoformat(), "train_rows": len(x_train), "validation_rows": len(x_validation), "test_rows": len(x_test), "validation": metrics_for(pipeline, x_validation, y_validation), "test": metrics_for(pipeline, x_test, y_test)}
    (output / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
