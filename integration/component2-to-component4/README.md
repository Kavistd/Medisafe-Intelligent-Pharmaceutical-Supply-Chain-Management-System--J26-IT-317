# Component 2 to Component 4 integration

Component 2 publishes the model result to `MedicineRiskRegistry`. Component 4
reads that registry during prescription dispensing and rejects unassessed,
over-threshold, or unsafe batches.

## Trust boundary

- The backend builds unsigned transaction data but does not hold the oracle's
  private key.
- An `ORACLE_ROLE` wallet reviews, signs, and broadcasts the transaction.
- Component 2 verifies the receipt, decoded calldata, destination contract, and
  final registry state.
- SHAP explanations remain off-chain and are not required by Component 4.

## Failure behavior

| Condition | Result |
| --- | --- |
| No risk assessment | Dispensing reverts with `RiskRecordNotFound` |
| Score above Component 4 threshold | Dispensing reverts with `HighMedicineRisk` |
| Component 2 marks batch unsafe | Dispensing reverts with `MedicineBatchUnsafe` |
| Oracle transaction reverts | Confirmation API returns an error |
| Wrong contract or calldata | Confirmation API rejects the transaction |
| Safe score at/below threshold | Component 4 continues its remaining checks |

## Verification

Run the Component 2 Python tests and the combined smart-contract integration
tests:

```bash
./.venv-component2/bin/pytest backend/component2-risk-scoring/tests -q
cd blockchain
npx hardhat test \
  test/component2/MedicineRiskRegistry.test.js \
  test/component4/PrescriptionRegistry.test.js
```
