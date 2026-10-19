# Component 1 -> Component 2

Component 1 sends the batch ID plus `Name`, `Category`, `Dosage Form`, `Strength`, `Manufacturer`, `Indication`, and `Classification`. Component 2 returns a 0-1 `risk_score`, its Low/Medium/High band, and feature contributions. Component 1 must not send patient information.

## On-chain integration

Component 2 reads the authoritative batch using
`MedicineTraceability.getBatch(batchId)` and maps these fields:

| Component 1 `BatchData` | Component 2 model field |
| --- | --- |
| `batchId` | `batch_id` |
| `name` | `Name` |
| `category` | `Category` |
| `dosageForm` | `Dosage Form` |
| `strength` | `Strength` |
| `manufacturerName` | `Manufacturer` |
| `indication` | `Indication` |
| `classification` | `Classification` |

Quantity, custody addresses, stage, recall state, timestamps, medicine ID, and
IPFS document references are not model inputs. Component 2 preserves the
case-sensitive batch identifier exactly and rejects a contract response whose
identifier differs from the requested value.

## Risk API endpoint

```http
POST /api/v1/risk/assess/batch/{batch_id}
```

The endpoint takes no request body. It returns the standard Component 2 risk
assessment. Responses are:

- `200` — batch retrieved and assessed;
- `404` — Component 1 batch does not exist;
- `400` — registered data cannot satisfy the agreed model payload;
- `503` — RPC, network, address, ABI, or deployed-contract configuration is unavailable.
