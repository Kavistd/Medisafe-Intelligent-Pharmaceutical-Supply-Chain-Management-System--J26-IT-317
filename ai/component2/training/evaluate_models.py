"""Evaluate a saved model on the reproducible held-out test split."""
from __future__ import annotations
import argparse, json
import joblib
from ._common import data_split, metrics_for

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--data", default="ai/component2/data/raw/component2_final_100000_training_dataset.csv")
    args = parser.parse_args()
    *_, x_test, __, ___, y_test = data_split(args.data)
    result = metrics_for(joblib.load(args.model), x_test, y_test)
    print(json.dumps(result, indent=2))

if __name__ == "__main__": main()
