# Component 2 - Explainable Medicine Risk Scoring

## Train

Install the pinned dependencies, then run from the repository root:

```bash
python -m ai.component2.training.train_random_forest
python -m ai.component2.training.train_xgboost
python -m ai.component2.training.compare_models
```

The selected pipeline is saved as `models/selected_model/model.joblib`. Training deliberately excludes record IDs, source labels, anomaly descriptions, and the synthetic score because they reveal the expected label.

## Inference payload

Provide `batch_id`, `Name`, `Category`, `Dosage Form`, `Strength`, `Manufacturer`, `Indication`, and `Classification`. `Strength` supports values such as `500 mg` and `0.5 g`.

## Risk bands

`0.00-0.39`: Low; `0.40-0.69`: Medium; `0.70-1.00`: High.

## Run the API

After training a selected model, run:

```bash
cd backend/component2-risk-scoring
PYTHONPATH=../.. uvicorn main:app --reload
```

The health endpoint is `GET /health`; submit a medicine batch to `POST /api/v1/risk/assess`.
