"""Train the XGBoost medicine risk model."""
from __future__ import annotations
import argparse
from xgboost import XGBClassifier
from ._common import train_and_save

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="ai/component2/data/raw/component2_final_100000_training_dataset.csv")
    parser.add_argument("--output", default="ai/component2/models/xgboost")
    args = parser.parse_args()
    report = train_and_save(XGBClassifier(n_estimators=350, max_depth=8, learning_rate=0.08, subsample=0.85, colsample_bytree=0.85, eval_metric="logloss", n_jobs=-1, random_state=42), "xgboost", args.data, args.output)
    print(report)

if __name__ == "__main__": main()
