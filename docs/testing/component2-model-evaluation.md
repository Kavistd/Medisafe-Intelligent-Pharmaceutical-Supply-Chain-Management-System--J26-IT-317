# Component 2 Model Evaluation

## Dataset and protocol

- Dataset: 100,000 medicine records (50,000 normal references and 50,000 synthetic anomalies).
- Features: medicine name, category, dosage form, parsed strength, manufacturer, indication, and classification.
- Excluded from training: record ID, data origin, anomaly type, anomaly fields, and synthetic anomaly score, to prevent label leakage.
- Stratified split: 70,000 training, 15,000 validation, and 15,000 test records.
- Model-selection rule: validation ROC-AUC, then validation F1-score.

## Results

| Model | Validation ROC-AUC | Validation F1 | Test ROC-AUC | Test F1 | Test Accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| Random Forest | 0.9019 | 0.8015 | 0.9076 | 0.8069 | 0.8205 |
| XGBoost | 0.9442 | 0.8565 | 0.9502 | 0.8641 | 0.8669 |

## Selected model

XGBoost is the selected Component 2 model because it has the strongest validation ROC-AUC and F1-score. The selected pipeline is generated locally at `ai/component2/models/selected_model/model.joblib`; generated model binaries are intentionally excluded from version control.
