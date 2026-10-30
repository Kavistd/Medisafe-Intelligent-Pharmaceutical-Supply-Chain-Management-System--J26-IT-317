# Component 3 Assessment Anchoring (PharmacyTrustAnchor)

> Research prototype. Weights (D 0.35, R 0.30, C 0.20, I 0.15) and tier thresholds (80 / 60 / 40) are
> proposed research parameters, not NMRA-prescribed values. A tier is decision support, not a regulatory decision.

## Purpose

Component 3 computes trust assessments off-chain (`backend/component3-pharmacy-trust`). This adds a small,
**additive** contract that records a tamper-evident commitment to each assessment on-chain:

| Piece | File |
|---|---|
| Contract | `blockchain/contracts/component3/PharmacyTrustAnchor.sol` |
| Hardhat tests | `blockchain/test/component3/PharmacyTrustAnchor.test.js` |
| Local deploy script | `blockchain/scripts/deploy/deploy_pharmacy_trust_anchor.js` |
| ABI export | `blockchain/scripts/deploy/export_pharmacy_trust_anchor_abi.js` -> `shared/abis/PharmacyTrustAnchor.json` |
| Off-chain payload builder | `backend/component3-pharmacy-trust/services/anchorPayload.js` (+ `tests/anchorPayload.test.js`) |

No existing contract, deploy script, address file or other component is changed.

## Design

**Identity.** A pharmacy is `pharmacyKey = keccak256(utf8(pharmacy code))` (`ethers.id(code)`). No wallet address,
name or personal data is stored on-chain.

**Off-chain commitment.** `buildAnchorPayload(assessment, pharmacyCode)` returns:

- `canonicalJson`: the assessment content (schema `component3.trust-assessment-anchor.v1`) with recursively sorted keys. It contains the status, unrounded score, tier, per-indicator breakdown, missing indicators, critical-escalation flag, finding IDs, evidence source and demo label.
- `assessmentHash`: `0x` + sha256(canonicalJson), used as the on-chain `bytes32`.
- `scoreMilli`: `Math.round(score * 1000)` (72.334 -> 72334), for chain encoding only. The displayed and stored score stays unrounded. It is `null` for NOT_ASSESSABLE.
  - If rounding would move a score across a tier boundary (e.g. 79.9996 -> 80000), the builder refuses, so on-chain and off-chain tiers can never disagree.
- The builder is pure. It sends no transaction, reads no environment variables, opens no database connection, and never changes `blockchainVerification`. That stays `NOT_PERFORMED` until a confirmed transaction exists and is checked.

**On-chain record.**

- `anchorAssessment(pharmacyKey, assessmentHash, scoreMilli, criticalEscalationRequired)` rejects `scoreMilli > 100000`. The contract derives the tier itself with the same proposed thresholds: >= 80000 HIGHLY_TRUSTED, >= 60000 TRUSTED, >= 40000 UNDER_REVIEW, otherwise ESCALATION_ALERT.
- `anchorNotAssessable(pharmacyKey, assessmentHash, criticalEscalationRequired)` stores status NOT_ASSESSABLE with **no score and no tier**. Missing evidence is never encoded as 0 or 100. A real score of 0 is ASSESSABLE.
- Each pharmacy keeps its latest record: status, scoreMilli, tier, hash, escalation flag, version, block timestamp and anchorer. The `version` increases with every anchor.
- Every anchor emits `AssessmentAnchored` with full data, so earlier versions remain recoverable from logs. Nothing is overwritten silently.
- `EscalationRaised(pharmacyKey, version, assessmentHash, reason)` is emitted when a critical finding is flagged (even with a high score) and/or the tier is ESCALATION_ALERT.
  - It is a **signal only**: no function blocks or restricts a pharmacy.
- Only `ANCHORER_ROLE` can anchor. The admin holds it at deployment and can grant or revoke it.

**Fail-closed reads.** `getLatest` returns `exists = false` for unknown pharmacies. `getScore` returns
`available = false` unless the latest record is ASSESSABLE. `exists` and `latestVersion` are also provided. There is
no default score and no default "trusted" flag.

## What anchoring proves, and what it does not

| Proves | Does NOT prove |
|---|---|
| An authorised anchorer recorded this exact assessment hash for this pharmacy key at this block time | That the underlying evidence is true, complete, verified or correctly attributed |
| The off-chain content matching the hash has not changed since it was anchored | That the weights or thresholds are valid (they are proposed research parameters) |
| The full anchor history (versions, scores, tiers, escalations) is publicly auditable | Real-world pharmacy performance (current assessments use synthetic data) |
| The on-chain tier is consistent with the encoded score | Any regulatory decision (anchoring is decision support only) |

## Relationship to the existing `PharmacyTrust.sol`

`blockchain/contracts/PharmacyTrust.sol` is **unchanged**. Its known issues stay open until they are discussed with the
Component 4 and Component 1 owners. Several existing scripts depend on its current constructor and its
`setPharmacyTrust(address,uint256,bool)` function: `scripts/seed/seed_component4.js`,
`integration/component4-evaluation/run.js` and `integration/component1-evaluation/cross-component.js`.

The known issues are:

- It is keyed by wallet address and stores a bool `isTrusted` with no tier.
- It **fails open**: unknown pharmacies get `getTrustScore = 100` and `isPharmacyTrusted = true`.
- It lacks `isPharmacyRegistered`, which `PrescriptionRegistryV2` requires. V2 therefore fails closed with `PharmacyRegistrationCheckUnavailable`.

`PharmacyTrustAnchor` deliberately does **not** implement the legacy `getTrustScore` / `isPharmacyTrusted`
interface, so it cannot be mistaken for a drop-in replacement with permissive defaults.

## How Component 4 could read it later (not implemented)

1. Agree on a pharmacy-code-to-wallet mapping with the Component 4 owner. The anchor stores no addresses by design, so this mapping would live in an approved off-chain or registry source.
2. Read with `getLatest(keccak256(code))`: refuse when `exists == false`, `status != ASSESSABLE`, the tier is below the agreed level, or the latest record is older than an agreed age.
3. Alternatively, add a separate reviewed adapter implementing `IPharmacyTrustV2` (`isPharmacyRegistered` = `exists`, score = `getScore`). This would be a new contract that both teams review; neither existing contract would be edited.
4. Subscribe to `EscalationRaised` for alerts. Any blocking policy is Component 4's decision, not this contract's.

## Running it

The contract and Hardhat tests were written for Solidity 0.8.20 and OpenZeppelin 5.6.1 (the versions pinned in
`blockchain/package-lock.json`). From `blockchain/`, after dependencies are installed:

```bash
npx hardhat compile
npx hardhat test test/component3/PharmacyTrustAnchor.test.js
npx hardhat run scripts/deploy/export_pharmacy_trust_anchor_abi.js       # writes shared/abis/PharmacyTrustAnchor.json
npx hardhat run scripts/deploy/deploy_pharmacy_trust_anchor.js           # in-process hardhat network
```

The deploy script is limited to the `hardhat` and `localhost` networks. It reads only the variable names
`PHARMACY_TRUST_ANCHOR_ADMIN` (defaults to the deployer) and `PHARMACY_TRUST_ANCHORER` (an extra anchorer to grant).
It prints the address and never writes `shared/blockchain/contract-addresses.json`.
