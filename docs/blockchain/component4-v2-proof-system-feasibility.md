# Component 4 V2 Patient Authorization Proof Feasibility

**Assessment date:** 2026-10-17
**Decision:** **NO-GO** for selecting or integrating a production proof system. Keep V2 dispensing blocked by `PatientAuthorizationUnavailable`.

## Scope and repository evidence

This is an architecture assessment, not an implementation. It does not select cryptographic parameters, create a verifier, or enable dispensing.

Repository inspection found:

- `blockchain/contracts/component4/v2/PrescriptionRegistryV2.sol` accepts no patient-derived value. It checks prescription lifecycle, risk, pharmacy registration, and trust, then always reverts with `PatientAuthorizationUnavailable`.
- V2 tests exercise that blocked path; there is no proof/verifier/status-root integration.
- `docs/blockchain/component4-v2-credential-lifecycle.md` defines an architecture-neutral `ACTIVE`/`REVOKED` state transition helper, but that helper is in-memory, has no persistence/API integration, and is not authoritative credential status.
- The existing Component 4 backend/frontend flow is V1-oriented. It uses a patient hash and does not provide a private credential proof system. Existing frontend dependencies do not include a ZK prover; blockchain/backend manifests do not include a proof, credential, or revocation stack.
- The primary Hardhat config targets Solidity 0.8.20 and its default local Hardhat EVM. Local V2 wallet/test configuration uses chain ID 31337. Optional Component 1/2 scripts mention Sepolia (11155111), but there is no V2 deployment address or declared production target chain. The shared address file has no V2 address. Thus EVM is the apparent development environment, while the actual intended deployment chain and its verifier/precompile/gas capabilities are unconfirmed.
- Hardhat chain ID 31337 is for local development and testing. The production/deployment network and chain ID remain pending explicit owner approval.

Repository facts above are distinct from external candidate properties below. No proof packages were installed, no contracts were changed, and no tests or builds were run for this assessment.

## Requirements to preserve

The proof statement must establish all of the following without revealing identity or reusable patient-linked values:

1. A doctor-authorized credential was issued and is valid for the required authorization attributes.
2. The prover knows the credential-bound secret.
3. The credential is currently non-revoked against authoritative current status (root or equivalent).
4. No stable credential identifier, patient-derived identifier, revocation handle, or reusable patient-linked nullifier is public.
5. The proof system has no trusted setup.
6. The proof has a practical, implementable verifier for the actual target chain.
7. Public proof inputs bind the prescription ID, intended pharmacy, expiry, chain ID, V2 registry address, and current status version/root.
8. Contract-side prescription revocation, expiry, risk/trust checks, and atomic single-use enforcement remain mandatory.

The intended nullifier strategy must be proven not to link two prescriptions. A nullifier scoped to a prescription can avoid cross-prescription equality but can still be correlated with that prescription; the opaque prescription itself must not derive from patient data. No candidate is assumed to satisfy this without a concrete circuit and privacy review.

## Candidate assessment

| Candidate and exact path | Proving / verification path and setup | Status and privacy fit | Assessment |
|---|---|---|---|
| **RISC Zero zkVM, raw succinct receipt** | A Rust guest could verify a doctor-signed credential, check a private credential witness against a revocation accumulator, and commit public context. RISC Zero describes composite and succinct receipts as ZK-STARKs. Its documented Ethereum route wraps STARK receipts in Groth16 for Solidity verification. | RISC Zero documents a STARK proof system and `env::commit` public outputs. However, the repository has no guest program, status-root protocol, Solidity verifier, gas evidence, or target-chain validation for the *raw* succinct receipt path. Raw STARK must not be treated as automatically zero-knowledge: the selected receipt mode, public/private input boundary, and construction need to be validated. | **Not selected.** The documented Solidity path is the Groth16 wrapper (see next row); a no-setup EVM verifier for raw succinct receipts is not established by the inspected evidence. |
| **RISC Zero succinct receipt wrapped in Groth16** | RISC Zero guest + succinct STARK + Groth16 wrapper and Solidity verifier. Official docs describe Ethereum contracts/verifier for this route. | The wrapper provides a practical EVM-style verification path, but RISC Zero explicitly documents a trusted setup ceremony for its Groth16 prover/verifier. That conflicts with the project's no-setup rule. Credential issuance, private status membership/non-revocation, unlinkability, and all required context binding still need a custom guest and tests. | **Rejected:** trusted-setup requirement violates a mandatory constraint. |
| **Semaphore V2-style membership proof (Groth16)** | JavaScript proof generation with setup artifacts and a Solidity verifier/`SemaphoreCore`; public root, external nullifier and nullifier hash. | Official docs say the proof establishes group membership and same-identity signal authorship, and require recording nullifiers to prevent reuse. Its documented circuit exposes a group root and scoped nullifier and uses `zkey`/`wasm` trusted-setup artifacts. A doctor credential and authoritative independently revocable status tree would require adapting group enrollment/updates and circuit semantics. A per-prescription scope may reduce cross-prescription linkage, but this is not the same as a reviewed proof of private credential non-revocation. | **Rejected:** trusted setup violates the requirement; the standard protocol does not directly meet credential/status semantics. |
| **Succinct SP1 zkVM with EVM Groth16 verifier** | Rust guest on SP1; SP1 Solidity verifier contracts support a Groth16 verification route on EVM. | SP1 describes itself as a zkVM, but the existence of a STARK/FRI backend alone does not establish that a particular proof output is zero-knowledge. The concrete Solidity Groth16 route is a SNARK wrapper and its setup assumptions must be checked for the exact version/circuit. No repository integration or target-chain tests exist. Credential status, unlinkability and context binding remain custom work. | **Not selected.** A concrete proof mode with independently verified ZK properties, transparent setup, compatible verifier, and adequate target-chain evidence is not established. Do not infer suitability from â€œSTARKâ€ or â€œzkVMâ€ branding. |
| **AnonCreds v1.0 CL credentials with CL_ACCUM revocation (`anoncreds-rs`)** | The AnonCreds specification and Rust reference implementation support issuer-signed CL credential presentations and private non-revocation proofs against a published accumulator snapshot. The NRP hides the witness, credential index, and tails entry. | This establishes relevant off-chain credential and revocation functionality, not a Solidity/EVM verifier. A selected accumulator snapshot does not itself establish that it is the authoritative current state. No maintained EVM implementation of the full CL credential and CL_ACCUM proof was identified. | **Not selected.** No evidenced transparent, setup-free, Solidity-verifiable composition or full context-binding and cross-prescription unlinkability construction was found. See [AnonCreds specification](https://hyperledger.github.io/anoncreds-spec/) and [`anoncreds-rs`](https://github.com/anoncreds/anoncreds-rs). |
| **Stwo Circle STARK / Stwo Cairo** | Stwo is a maintained, transparent Circle STARK implementation with no trusted setup. The reviewed Stwo Cairo documentation states that its STARK is not zero-knowledge by default. | Stwo has a Rust `no_std` verifier described as suitable for embedding in on-chain environments; Stwo Cairo has a Cairo verifier for recursive Cairo verification. No maintained Solidity verifier for the exact Stwo proof mode was identified. | **Not selected.** The documented privacy property and Solidity verifier path do not meet the requirements. A custom AIR/guest is only a possible research direction, not evidence of a compliant proof. See [Stwo](https://github.com/starkware-libs/stwo) and [Stwo Cairo security model](https://github.com/starkware-libs/stwo-cairo). |
| **Winterfell STARK** | The Rust STARK implementation is transparent and does not require a trusted setup, but its repository states the current implementation does not provide perfect zero knowledge and may leak secret-input information. | The maintained verifier is Rust; no maintained Solidity/EVM verifier for the exact Winterfell proof format was identified. | **Not selected.** The documented privacy limitation and missing EVM verifier fail mandatory criteria. See [Winterfell](https://github.com/facebook/winterfell). |

### Evidence and interpretation

- RISC Zero's official proof-system documentation distinguishes composite/succinct ZK-STARK receipts from the Groth16 receipt route. Its Ethereum integration documentation describes wrapping STARK proofs with Circom Groth16 for on-chain verification. Its trusted-setup documentation confirms that a Groth16 ceremony was run. See [RISC Zero proof system](https://dev.risczero.com/proof-system/), [Ethereum integration](https://dev.risczero.com/api/blockchain-integration/risc-zero-on-eth), and [trusted setup](https://dev.risczero.com/api/trusted-setup-ceremony).
- Semaphore's official docs describe off-chain proof generation and on-chain Solidity verification, with setup artifacts and a stored nullifier for single-use signaling. The current docs identify a trusted setup ceremony. The V2 circuit reference lists public root, external nullifier and nullifier hash. See [Semaphore proof guide](https://docs.semaphore.pse.dev/V2/guides/proofs), [circuit reference](https://docs.semaphore.pse.dev/V2/technical-reference/circuits), and [protocol overview/setup](https://docs.semaphore.pse.dev/).
- Succinct's project describes SP1 as a zkVM, and its official contract repository contains Solidity verifier sources. Those facts alone do not establish the security properties of each SP1 proof mode or suitability of a no-setup EVM path. See [SP1 project](https://github.com/succinctlabs/sp1) and [SP1 Solidity contracts](https://github.com/succinctlabs/sp1-contracts).

These sources establish that candidate stacks and certain verifier routes exist. They do **not** establish an end-to-end implementation satisfying this project's credential, revocation, unlinkability, target-chain and context-binding requirements. Compatibility with an unspecified production chain is an assumption, not a verified fact.

The same limitation applies to general-purpose zkVMs: being able to execute a program in a zkVM does not establish that the exact proof mode is zero-knowledge, setup-free, or supported by a Solidity verifier, nor that a guest correctly implements the required credential, current-status, privacy, and context-binding relation. These properties require evidence for the specific mode, program, public inputs, and verifier.

## Decision and blockers

**NO-GO: no candidate is recommended.** None of the reviewed evidence demonstrates all mandatory requirements at once. In particular:

1. The real deployment chain is unspecified. EVM-compatible does not by itself prove that the chosen verifier bytecode, precompiles, gas cost, or deployed verification-key support will work on that chain.
2. No examined repository architecture defines doctor credential issuance, attribute semantics, or reissuance/key rotation.
3. No authoritative, independently operated revocation root/version exists. The helper is not persistent or connected to an issuer/status service.
4. A proof of current non-revocation without a stable public index/handle and without cross-prescription linkage has not been designed or demonstrated.
5. Semaphore and the documented RISC Zero Groth16 route conflict with the no-trusted-setup requirement. For raw STARK/zkVM paths, an implementable, sufficiently efficient Solidity verifier and exact zero-knowledge guarantees for the chosen mode remain unproven here.
6. No circuit/guest public-input schema or test demonstrates binding to every required context field and the authoritative status version/root.
7. No adversarial tests or independent cryptographic review exist for proof soundness, credential issuer authorization, revocation freshness, replay, or nullifier unlinkability.

No reviewed candidate has demonstrated the complete combination of zero knowledge, no trusted setup, private current credential non-revocation, cross-prescription unlinkability, required context binding, and a practical Solidity/EVM verifier. AnonCreds supplies relevant private non-revocation functionality, but a complete, evidenced EVM-verifiable construction has not been established.

The existing backend serial-test results are backend behavior checks only. They are not evidence of Solidity compilation, proof-system compatibility, cryptographic security, or V2 dispensing authorization.

## Smallest experiments to resolve the blockers

1. **Fix the target:** record the exact chain, network/chain ID, execution environment, Solidity version, verifier bytecode limits, relevant precompiles, and acceptable verification gas. Confirm whether private EVM deployment is intended or a public chain.
2. **Require candidate-specific evidence:** for each viable transparent/no-setup candidate, identify the exact proof mode and version, primary specification for its ZK and soundness properties, setup model, proving stack, maintained Solidity verifier, and a successful verification example on the exact target chain. Obtain measured proof size and gas. Do not use a wrapped SNARK if its setup conflicts with policy.
3. **Prototype the statement off-chain only:** define an issuer-signed credential and independent revocation accumulator/status tree. Build a minimal circuit/guest that privately verifies credential validity, secret possession, and non-revocation while publicly binding `prescriptionId`, `intendedPharmacy`, `expiry`, `chainId`, `registryAddress`, and `statusRoot/version`. Demonstrate two credentials' proofs cannot be linked by public outputs; inspect all public inputs and emitted calldata.
4. **Review nullifier necessity:** atomic single-use is already enforced by the prescription's on-chain ACTIVEâ†’USED transition once authorization is enabled. If a proof nullifier is retained for defense-in-depth, derive it using a domain tied to an opaque prescription and prove its output cannot link separate prescriptions. Do not expose a global nullifier or stable credential handle.
5. **Only after the above:** integrate an immutable/versioned verifier interface and authoritative root freshness policy; add tests for altered context, invalid issuer, revoked/stale status, replay, wrong pharmacy, expired/revoked prescription, risk/trust failure, and concurrent/repeated dispensing. Maintain fail-closed behavior if the verifier or status source is unavailable.

No experiment above has been performed. Until evidence resolves all blockers and receives cryptographic review, retain `PatientAuthorizationUnavailable` and do not accept proof bytes or enable dispensing.
