# Component 1 Phase 7 — local application setup

Use only a disposable local research environment. These utilities bind to loopback, never reset an existing node, suppress Hardhat key output, reuse the existing deployment/role scripts and put deployment addresses/ABI exports/role assignments/fixture files in ignored `.runtime/`. Shared configurations, Solidity and Components 2–4 are unchanged. No private key is read, generated, imported or printed by these launchers. Local generated operator tokens remain in ignored configuration files, never browser bundles or console output.

Install the existing lockfiles if needed (`npm ci --prefix blockchain`, `npm ci --prefix backend/component1-traceability`, `npm ci --prefix frontend`) and compile from `blockchain/` with `npm run compile`. Prefer supported Node 22 LTS. The available Node 23 installation is not Hardhat-supported. Commands below run from the **repository root**, each long-running command in its own terminal:

```powershell
# Terminal A: keep open. All account/private-key output is discarded.
node integration/component1-local/start-chain.js

# Terminal B: one-time setup, or rerun after restarting the node.
node integration/component1-local/setup.js

# Terminal B: keep open. This is the mock backend launcher, not npm start.
node integration/component1-local/start-backend.js

# Terminal C: keep open.
node integration/component1-local/start-frontend.js

# Terminal D: health/configuration/mock-document integration checks.
node integration/component1-local/verify.js
```

The setup refuses to overwrite unmanaged backend `.env` or frontend `.env.local` files. It reuses a matching deployment receipt and bytecode on rerun; after a fresh node it deploys again when necessary. Stop and restart backend/frontend after rerunning setup. Node restart loses all local on-chain state. No automatic reset is performed. To stop a launcher you started, press Ctrl+C in its terminal.

Endpoints:

- Hardhat: `http://127.0.0.1:8545`, chain ID **31337**.
- Component 1 API: `http://127.0.0.1:5001/health`, `/health/blockchain`.
- Component 1 interface: `http://127.0.0.1:5173/traceability.html`.
- Existing Component 4 frontend: `http://127.0.0.1:5173/`. Its separate backend and contract deployments are not started or certified by this setup. Do not assume old shared addresses contain Component 4 code on a fresh chain.

Fixture account assignment: account 0 administrator, account 1 manufacturer, account 2 distributor, account 3 pharmacy, account 4 recall. `setup.js` reports public addresses only. Do not export their keys or import an account with real assets. Browser/MetaMask work is a separate, user-guided next step; fresh disposable MetaMask public addresses can later be funded and assigned roles locally after review. No seed phrase/private key needs to be shared in chat.

The backend serves **only** these synthetic PDFs for mocked pinning/downloads:

```text
integration/component1-local/.runtime/certificate.pdf
integration/component1-local/.runtime/laboratory-report.pdf
```

Choose these files during later browser testing. Their exact SHA-256 values are allowlisted in the generated backend config. Other bytes remain rejected by the Phase 4 approval gate. Mocking is injected through the existing `DocumentService` fetch hook: the Pinata adapter still validates file/MIME/metadata/approval and returned CIDs, but every pinning/gateway fetch resolves in memory. No IPFS network request is made. Ordinary backend `npm start` is deliberately not used; mock mode is rejected by the ordinary Pinata-only provider path rather than silently allowing publication.

Generated ignored files:

- `backend/component1-traceability/.env`: local RPC, address, mock mode, public fixture allowlist and generated operator token.
- `frontend/.env.local`: matching public address/deployment block, local server RPC and the same server-only operator token. Never prefix secrets with `VITE_`.
- `.runtime/addresses.json`, `MedicineTraceability.json`, `deployment.json`, `roles.json`, and the two fixture PDFs.

Check ignored status without printing file contents:

```powershell
git check-ignore backend/component1-traceability/.env frontend/.env.local integration/component1-local/.runtime/deployment.json
```

Local tests: `node --test --experimental-test-isolation=none integration/component1-local/local.test.js`. `verify.js` performs real local HTTP and wallet-helper checks with unlocked synthetic Hardhat signers; it does not automate a browser or MetaMask and does not create medicine batches. The Phase 6 one-replica tests separately exercise registration, custody, rejection, cancellation, recall and expiry on their own disposable chain without advancing/resetting the application's chain.

If a port is occupied, stop the known owner yourself or reuse the verified service; do not kill unrelated processes. If the sandbox prevents a compiler/server subprocess from starting, use an explicitly approved retry rather than editing configuration to point to a public service. If health fails after a node restart, rerun setup, then restart backend/frontend; confirm addresses and roles with `verify.js`. Do not print configuration contents to diagnose token mismatch. Backend document limits still apply (20 requests/minute, two active requests); wait a minute before repeating document-heavy verification.
