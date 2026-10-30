# Component 2 -> Component 4

Component 4 reads the latest Component 2 risk record by medicine batch ID. The authoritative on-chain value is `riskScore` on a 0–100 integer scale; divide it by 100 to obtain the model's 0–1 risk score. Component 2 exposes `hasBatchRisk(batchId)` so a recorded score of `0` is distinguishable from a missing record. Component 4 rejects a missing record, a score outside 0–100, and every score `>= 70`. It also rejects contradictory values: `isSafe` must be true exactly when the integer score is below 70. Component 2 validates the same range and consistency when writing a record. Producers must derive `isSafe` from the rounded integer score, not the unrounded model value. SHAP explanations remain off-chain in the Component 2 API response.

## Publishing workflow

1. Assess the registered Component 1 batch and build an unsigned transaction:

   ```http
   POST /api/v1/risk/assess/batch/{batch_id}/transaction
   Content-Type: application/json

   {"sender":"0xORACLE_WALLET"}
   ```

2. The oracle wallet signs and broadcasts the returned `setBatchRisk`
   transaction. The wallet must hold `ORACLE_ROLE`.
3. Confirm the mined transaction and stored registry state:

   ```http
   POST /api/v1/risk/publish/confirm
   Content-Type: application/json

   {
     "batch_id":"BATCH-001",
     "risk_score":0.22,
     "transaction_hash":"0x..."
   }
   ```

Confirmation succeeds only when the receipt is successful, the destination is
the configured `MedicineRiskRegistry`, decoded calldata matches the expected
batch/score/safety values, and the final stored state matches the assessment.

## Component 4 enforcement

Before dispensing, `PrescriptionRegistry` applies these checks in order:

 1. `hasBatchRisk(batchId)` must be true. Missing assessments fail closed with
    `RiskRecordNotFound`.
2. `getRiskScore(batchId)` must not exceed `maxAllowedRiskScore` (default 50).
3. `isBatchSafe(batchId)` must be true. Component 2 marks scores `>= 0.70`
   unsafe.

An unknown registry batch is unassessed. Component 4 must never interpret the
default zero score as an approved assessment.
