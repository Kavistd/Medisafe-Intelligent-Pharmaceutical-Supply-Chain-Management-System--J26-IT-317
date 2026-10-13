"""Train the Random Forest medicine risk model."""
from __future__ import annotations
import argparse
from sklearn.ensemble import RandomForestClassifier
from ._common import train_and_save

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="ai/component2/data/raw/component2_final_100000_training_dataset.csv")
    parser.add_argument("--output", default="ai/component2/models/random_forest")
    args = parser.parse_args()
    report = train_and_save(RandomForestClassifier(n_estimators=150, min_samples_leaf=2, class_weight="balanced", n_jobs=-1, random_state=42), "random_forest", args.data, args.output)
    print(report)

if __name__ == "__main__": main()
