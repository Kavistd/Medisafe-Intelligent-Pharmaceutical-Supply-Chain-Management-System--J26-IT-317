"""Compare validation metrics and publish the selected model artifact."""
from __future__ import annotations
import argparse, json, shutil
from pathlib import Path

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="*", default=["ai/component2/models/random_forest", "ai/component2/models/xgboost"])
    parser.add_argument("--output", default="ai/component2/models/selected_model")
    args = parser.parse_args()
    candidates=[]
    for item in map(Path, args.models):
        report=json.loads((item / "metrics.json").read_text(encoding="utf-8")); candidates.append((report, item))
    best, source=max(candidates, key=lambda c: (c[0]["validation"]["roc_auc"], c[0]["validation"]["f1"]))
    output=Path(args.output); output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / "model.joblib", output / "model.joblib")
    (output / "selection.json").write_text(json.dumps({"selected_model": best["model"], "selection_metric": "validation ROC-AUC, then F1", "metrics": best}, indent=2), encoding="utf-8")
    print(json.dumps({"selected_model": best["model"], "validation": best["validation"]}, indent=2))

if __name__ == "__main__": main()
