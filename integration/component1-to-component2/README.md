# Component 1 to Component 2 integration

Component 2 reads registered medicine batches directly from the
`MedicineTraceability` contract and submits the allow-listed medicine fields to
the selected risk model.

## Configuration

```bash
export WEB3_RPC_URL=http://127.0.0.1:8545
export TRACEABILITY_NETWORK=localhost
```

The traceability address is resolved from
`shared/blockchain/contract-addresses.json`. An explicit
`MEDICINE_TRACEABILITY_ADDRESS` takes precedence for temporary deployments.

## Request

```bash
curl -X POST http://127.0.0.1:8000/api/v1/risk/assess/batch/BATCH-001
```

No caller-supplied medicine fields are accepted by this endpoint. This prevents
the assessment from using values that differ from the authoritative registered
batch. The integration is read-only and does not require a private key.
