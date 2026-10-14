# Component 1 deployment and shared data configuration

## Scope and conventions

Phase 2 adds deployment, participant role assignment, an exported ABI and a
registration schema. It does not modify any Solidity contracts or Components
2–4. Run commands from `blockchain/` on the feature branch.

The base `hardhat.config.js`, package manifest and lockfile are unchanged.
`hardhat.traceability.config.js` extends the base compiler/toolbox setup and adds
Sepolia only when `RPC_URL` is set. It reuses the existing `RPC_URL` and
`PRIVATE_KEY` environment names. The default configuration remains usable for
local compilation, tests, deployment and role setup.

Use the dependencies installed from the existing lockfile (`npm ci` if needed).
Use a Node version supported by the installed Hardhat release. Node 23 produced
a warning during Phase 1; do not interpret a passing test as official support.

## ABI and address configuration

Generate the ABI without deploying:

```powershell
npm run compile
npx hardhat run scripts/deploy/export_traceability_abi.js
```

The generated file is `shared/abis/MedicineTraceability.json`, with the existing
Component 4 convention `{ "contractName": "MedicineTraceability", "abi": [...] }`.
Consumers pass its `.abi` property to ethers. The file contains no bytecode,
addresses or secrets. `shared/blockchain/abi/` is a separate placeholder used by
Component 2's planned integration; no existing ABI is moved or replaced.

`shared/blockchain/contract-addresses.json` already has empty
`MedicineTraceability` slots for hardhat, localhost, sepolia and mainnet. They
remain empty until a real persistent deployment is recorded. The deployment
script updates only the selected network's `MedicineTraceability` property
after confirmation and preserves all other component entries. It does not
write addresses for ephemeral `hardhat` runs and rejects mainnet/unknown
networks. No example or guessed contract addresses belong in this file.

On `localhost` and Sepolia the script checks the selected chain ID (31337 and
11155111 respectively). A fresh local node invalidates all previous local
deployments, including existing teammate address entries. The Component 1
script does not reset or fix those entries. Do not assume a nonempty address
means that a contract is deployed on a newly started node.

Deployment output reports network, actual contract address, admin, transaction
hash, block number and whether the address was saved. A filesystem failure after
a successful transaction can leave configuration incomplete; inspect the
deployer's on-chain transaction history before rerunning and record only the
confirmed address. Preserve the deployment output for that recovery case.

## Local Hardhat deployment

In terminal A, start a persistent development node:

```powershell
npx hardhat node
```

The Hardhat node prints development-only account keys. Never use those keys on
a public network or copy them into project documentation.

In terminal B, also from `blockchain/`:

```powershell
npm run compile
npx hardhat run scripts/deploy/deploy_traceability.js --network localhost
```

By default the first local signer is the administrator. Set `TRACEABILITY_ADMIN`
to a nonzero public address before deployment to use a different administrator.
Only the administrator role is granted by the constructor. An explicit admin
must later sign role setup; deploying the contract does not authorize the
deployer if the selected admin differs.

For an ephemeral smoke deployment instead:

```powershell
npx hardhat run scripts/deploy/deploy_traceability.js
```

This exports the ABI but does not save an address. The temporary chain is gone
when the command exits, so a separate role setup process cannot use it.

## Participant permissions

Copy `blockchain/config/traceability-roles.example.json` to a participant JSON
file and populate its arrays with real public participant addresses:

- `MANUFACTURER_ROLE`
- `DISTRIBUTOR_ROLE`
- `PHARMACY_ROLE`
- `RECALL_ROLE`

Empty arrays are allowed for roles not yet assigned, but the file must contain
all four keys and at least one participant. There are no default participant
addresses. Zero/invalid addresses, unknown roles and administrator grants are
rejected. Duplicates within a role are removed. Multiple roles on one account
are allowed by the Phase 1 contract; separate participant accounts are useful
when demonstrating custody handoffs.

For example, set the path to your reviewed file and run on the persistent node:

```powershell
$env:TRACEABILITY_ROLES_FILE = (Resolve-Path config/traceability-roles.local.json).Path
npx hardhat run scripts/interactions/setup_traceability_roles.js --network localhost
```

The signer must hold `DEFAULT_ADMIN_ROLE`. By default localhost uses the first
unlocked node account. To use another configured account, set
`TRACEABILITY_SIGNER` to its public address. It must be present among Hardhat's
configured signers; the script does not impersonate accounts. Role setup reads the selected network's shared contract address,
unless `CONTRACT_ADDRESS_TRACEABILITY` explicitly overrides it. An empty or
stale override should be removed. The script verifies exact runtime bytecode
against the current compiled artifact, so a different build or a different
component at the address is rejected. Preserve the compiler configuration and
use the artifact matching the deployment.

All assignments are validated before any grant. Grants are separate confirmed
transactions, not an atomic batch: if a later grant fails, earlier grants remain.
Rerunning skips existing grants and reports each account's outcome. The script
does not revoke roles or transfer admin privileges.

## Ethereum Sepolia: instructions only, approval required

No Sepolia deployment is part of Phase 2 verification. Obtain explicit approval
before sending deployment or role-assignment transactions on Sepolia. The
scripts also require `TRACEABILITY_ALLOW_SEPOLIA=true` as an execution guard;
setting that flag does not substitute for approval.

Supply these values securely through the process environment or your local
secret manager, without printing them or committing them:

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Sepolia RPC endpoint (may contain a provider credential) |
| `PRIVATE_KEY` | Funded deployer key; 0x-prefixed 32 bytes |
| `TRACEABILITY_ADMIN` | Explicit nonzero public administrator address; required for Sepolia deployment |
| `TRACEABILITY_ALLOW_SEPOLIA` | Must be `true` after approval |
| `TRACEABILITY_ROLES_FILE` | Path to reviewed public role assignments |
| `TRACEABILITY_SIGNER` | Optional public address selecting the role administrator from configured signers |
| `CONTRACT_ADDRESS_TRACEABILITY` | Optional role-script override; otherwise use shared network configuration |

No dotenv dependency is added. Hardhat does not automatically load the root
`.env` with these scripts. Prefer process environment injection. If using an
ignored `.env` file locally with a Node version supporting `--env-file`, invoke
Hardhat through Node with that option; do not assume `npx hardhat` loads it.
Never paste credentials into checked-in files, command transcripts or issue
reports. Script failure handlers omit raw provider errors because they can
contain credential-bearing URLs.

After approval and secure environment setup:

```powershell
npx hardhat compile --config hardhat.traceability.config.js
npx hardhat run scripts/deploy/deploy_traceability.js --config hardhat.traceability.config.js --network sepolia
```

The config enforces Sepolia chain ID 11155111; without `RPC_URL`, Sepolia is not
configured. Without a signing key there is no deployer. The script records the
confirmed address only in `sepolia.MedicineTraceability` and exports the ABI.

Review the deployed address and admin. If the admin differs from the deployer,
securely switch `PRIVATE_KEY` to the admin's key before role setup:

```powershell
npx hardhat run scripts/interactions/setup_traceability_roles.js --config hardhat.traceability.config.js --network sepolia
```

Remove sensitive environment variables after use in that terminal:

```powershell
Remove-Item Env:PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:RPC_URL -ErrorAction SilentlyContinue
Remove-Item Env:TRACEABILITY_ALLOW_SEPOLIA -ErrorAction SilentlyContinue
```

## Shared batch schema

`shared/schemas/medicineBatch.schema.json` is draft-07 and describes the flat
`BatchData` registration input, not the returned `Batch` custody wrapper.
All 14 Solidity input fields are required. Unknown properties are rejected,
including caller-supplied custody state and patient information. Text fields
must contain a character outside ASCII control/space range U+0000–U+0020,
matching the contract's nonblank check for ordinary UTF-8 input. String batch
IDs remain case-sensitive and are not trimmed or reformatted.

Quantity and timestamps are positive JSON integers up to 9007199254740991 to
avoid JavaScript precision loss. This is an intentional API-safe subset of
Solidity uint256. Timestamps represent Unix seconds. Draft-07 cannot compare
sibling fields or chain time: submission code and the contract must additionally
enforce `manufacturedAt <= block.timestamp < expiresAt` and
`manufacturedAt < expiresAt`. Uniqueness is also enforced by the contract.

Document/certificate references are mandatory nonblank strings. This preserves
Phase 1's accepted values; full CID parsing, pinning, availability and certificate
authenticity remain document-service responsibilities, not schema guarantees.

Existing Component 2 compatibility is a mapping, not a change to its API:

| Component 1 field | Component 2 field |
| --- | --- |
| `batchId` | `batch_id` |
| `name` | `Name` |
| `category` | `Category` |
| `dosageForm` | `Dosage Form` |
| `strength` | `Strength` |
| `manufacturerName` | `Manufacturer` |
| `indication` | `Indication` |
| `classification` | `Classification` |

Do not submit this whole schema object directly to Component 2; the future
adapter should send the existing agreed payload. No API contracts, risk scores,
pharmacy configuration or prescription interfaces are changed in Phase 2.

## Automated verification

```powershell
npm run compile
npx hardhat run scripts/deploy/export_traceability_abi.js
npx hardhat test test/component1/MedicineTraceability.test.js test/component1/TraceabilityDeployment.test.js test/component1/MedicineBatchSchema.test.js
npm test
```

Deployment tests use actual contracts on the in-process Hardhat network and
temporary files. Persistent address-write behavior is tested using that local
provider with a localhost network label and a temporary address registry; no
shared deployment addresses are fabricated. Tests cover preservation of other
component entries, ABI parity, admin selection, network guards, role setup,
idempotence, malformed assignments, wrong contracts and schema validation.
Sepolia guard tests use a stub provider; no external RPC or public transactions
are used. Schema tests reuse Ajv already present in the existing lockfile's
dependency tree; no package installation or version changes are required.

### Phase 2 verification results

- Forced compilation: 9 Solidity files compiled successfully, target Paris.
- ABI export: succeeded; automated tests confirm exact compiled ABI parity.
- Component 1 tests using the opt-in traceability config: 98 passing, zero
  failing (62 contract tests, 16 deployment/configuration tests, 20 schema tests).
- Full blockchain suite using the unchanged base config: 152 passing, zero
  failing. This includes 54 existing prescription test executions across the
  two pre-existing test files.
- `git diff --check`: passed. Package files, base Hardhat config, all Solidity
  contracts and the shared address registry are unchanged.

The sandbox initially blocked the native compiler (HH505) and Hardhat's ABI
export subprocess (HH602 / spawn EPERM). Approved retries succeeded. Node.js
v23.10.0 still triggers Hardhat's unsupported-version warning. No dependency
installation was necessary. No persistent local or Sepolia deployment was
performed; deployed test contracts existed only on the in-process test chain.
