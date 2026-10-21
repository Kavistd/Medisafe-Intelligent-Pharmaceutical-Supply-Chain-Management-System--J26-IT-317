# Component 1 — Phase 5 frontend

Open `/traceability.html` for Component 1. `/` remains the existing Component 4 prescription interface. Both pages are included in the Vite production build; Component 4 source is unchanged.

Component 1 now supports `VITE_TRACEABILITY_CHAIN_ID=31337` (default) or `11155111` (Ethereum Sepolia); other networks are rejected. Wallet checks, prepared transactions, document-signature domains, gateway RPC checks and the displayed network follow this setting. For separate ignored profiles, mode-specific startup/build commands and deployment approval gates, see [Sepolia preparation](../../../integration/component1-sepolia/README.md). Keep provider JWTs and signing keys out of frontend environments; only public chain/address settings use `VITE_`. Existing local mock launchers remain unchanged.

From `frontend/`, install the existing lockfile with `npm ci`, copy `.env.example` to ignored `.env.local`, then run `npm run dev`. Set `VITE_TRACEABILITY_ADDRESS` to the existing local MedicineTraceability deployment and `VITE_TRACEABILITY_START_BLOCK` to its deployment block. The backend must use the same deployment. Start the already-configured Component 1 API on `127.0.0.1:5001`, Component 4 on port 5004, and use chain 31337 in your injected Ethereum wallet. No automatic deployment or role grants occur.

Manufacturer, distributor, pharmacy and tracking views share exact batch search, current ownership, metadata, pending custody, completed history, recall/expiry badges and document downloads. Manufacturers can register and transfer to distributors; distributors can accept/reject and transfer to pharmacies; pharmacies can accept/reject and inspect history. Senders can cancel pending requests, including invalidated batches. Confirm/transfer controls are disabled for expired/recalled records. Contract simulation and execution remain authoritative. The frontend does not present an automatic recall action in this phase.

Role-dashboard batch lists use actual `BatchRegistered` and `TransferInitiated` logs from the configured contract via the connected wallet's RPC, followed by existing backend batch/pending/history/status reads. The public catalogue uses the separate read-only discovery endpoint documented below. Each scan covers up to 1,000 blocks; click again to continue. Start at the deployment block to avoid unnecessary empty scans. Lists only include activity already scanned, and incoming lists filter current pending recipients. Search works without a connected wallet using backend reads. Existing legacy contract references may not be downloadable if they are not valid CIDs.

## Wallet transaction security

Backend writes use the existing registration/initiate/confirm/cancel/reject preparation endpoints. The client verifies destination, sender, local chain, zero value and complete expected ABI calldata before asking the wallet to send. Account and network are checked before signing; changes clear the session. The wallet estimates current gas, signs and broadcasts; the UI waits for confirmation before reporting success and refreshing the batch. No keys or wallet passwords are requested or stored. Registration expects canonical base32 CIDv1 (the format returned by upload); CIDv0 references can still be used through the backend API. User-entered dates are local time converted to Unix seconds.

## Public document authorization

Do **not** enter the document operator token in a browser or `VITE_` variable. Keep `IPFS_API_TOKEN` only in the frontend server's ignored `.env.local`, matching the backend's operator token. Keep the separate pinning-provider token exclusively in the backend. The local Vite server and preview middleware intercept only existing `/api/v1/traceability/documents` paths. It requires a fresh wallet signature over host, registry, local chain, method, exact path, multipart bytes digest, timestamp and nonce. It rejects replays and checks current on-chain roles before adding the server-held operator token to the backend request. Uploads require MANUFACTURER_ROLE; downloads require manufacturer/distributor/pharmacy/recall role. The actual Phase 4 API still validates exact public-content allowlisting, file types, metadata and upload limits. No approval bypass exists in the UI or adapter.

Before uploading, an operator must review the exact public certificate/report and add its SHA-256 to the **backend** allowlist. The user must also tick the publication attestation. Never publish patient or confidential information. CID responses populate `certificateReference` / `documentReference` in registration. A CID does not prove issuer identity, authenticity or medicine safety.

Downloads use wallet-authorized requests through the backend's bounded gateway and are saved as attachments, not embedded or rendered inline. Tokens and signatures are not placed in URLs or browser storage. Wallet connection is in-memory. Document requests are limited to two active requests at the adapter and the Phase 4 backend's existing per-process request limit; nonce tracking is bounded. Provider/API errors are displayed without forwarding server credentials.

This adapter is for local research with Vite dev/preview, not a production authorization service. A static-only deployment cannot upload/download because it has no secret-holding server. Preserve the adapter's checks in a reviewed production server before hosting. No real provider call is required for frontend tests. The adapter does not replace Phase 4 review, malware scanning, issuer verification or independent gateway-content verification.

## Verification

`npm test` runs existing Component 4 tests plus Component 1 client/gateway tests. `npm run build` builds both pages. Tests use Node's test runner, mocked wallets/providers and local HTTP server fixtures; they do not claim real MetaMask, browser-layout or live IPFS verification.

## Medicine Tracking

Medicine Tracking uses the existing exact Batch ID search to open batch details and custody history without connecting a wallet. The All Medicine Batches catalogue and its automatic event scanning have been removed from the page. Role-dashboard event discovery and all existing wallet-authorized actions remain unchanged.
