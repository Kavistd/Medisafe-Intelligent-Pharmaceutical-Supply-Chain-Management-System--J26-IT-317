# Phase 4 — public medicine documents

The document service uploads/pins medicine certificates and laboratory test reports using a Pinata-compatible pin-file endpoint. Provider configuration lives only in environment variables. The adapter follows the provider's [official pin-file API definition](https://github.com/PinataCloud/docs/blob/main/pinata-api-ipfs.yaml). No real uploads are made by tests.

## Configure and authorize

Set `IPFS_PROVIDER=pinata`, `IPFS_PROVIDER_TOKEN` to a provider JWT, and `IPFS_API_TOKEN` to a **different**, randomly generated token of at least 32 characters. The document API fails closed without its API token. Give the API token only to approved document publishing operators; it is an administrative service credential, not a public browser token or a blockchain wallet credential. Never put either token in source, URLs, logs or browser-exposed configuration. The existing Vite gateway needs only the operator token in its ignored, server-only environment; never use a `VITE_` prefix for secrets or place the provider JWT there. Use TLS if exposing the locally bound API through a reverse proxy. Provider endpoint and gateway must be trusted, administrator-configured HTTPS URLs without embedded credentials, queries or fragments. Redirects are rejected. Only the pinning endpoint receives the provider JWT; the gateway receives no credentials.

Supported implementation: `pinata`. Override `IPFS_PIN_ENDPOINT` for a compatible pin-file provider endpoint, or `IPFS_GATEWAY_URL` for a trusted HTTPS gateway whose base path ends in `/ipfs/`. Other protocols require another adapter. Provider responses must include a valid `IpfsHash`, numeric `PinSize` and parseable `Timestamp`; asynchronous pin jobs are not accepted as successful uploads.

## Separate local Pinata profile (no publication approval)

Use `backend/component1-traceability/.env.pinata.local` for real-provider preparation, leaving the managed backend `.env`, frontend `.env.local` and mock launchers unchanged. The backend-local `.gitignore` excludes this profile. It starts with an empty provider JWT and empty publication allowlist, reuses the existing server-side operator token so the frontend gateway still matches, and retains the current local contract address. Do not run local setup to switch providers: that utility intentionally configures mock mode.

1. Open `.env.pinata.local` directly in your editor. Enter the scoped Pinata JWT after `IPFS_PROVIDER_TOKEN=` and save. Never paste it into chat, commands, tracked files or screenshots. No API key/secret pair is needed by this bearer-JWT adapter.
2. Retain these settings:

   ```dotenv
   IPFS_PROVIDER=pinata
   IPFS_PIN_ENDPOINT=https://api.pinata.cloud/pinning/pinFileToIPFS
   IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs/
   ```

   The endpoint expects the legacy `IpfsHash`, `PinSize`, `Timestamp` response. Do not replace it with a V3 upload URL without adapting the implementation. The gateway must permit credential-free retrieval; authenticated gateway URLs are not supported by this adapter. Live account permissions, endpoint access and gateway availability remain unverified until separately authorized live checks.
3. Keep `IPFS_APPROVED_SHA256=` empty until explicit approval to publish the exact synthetic files. Calculate their public hashes from the repository root:

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath integration/component1-local/.runtime/certificate.pdf
   Get-FileHash -Algorithm SHA256 -LiteralPath integration/component1-local/.runtime/laboratory-report.pdf
   ```

   After document review and publication approval, enter both hash values separated by a comma. Any byte change requires review and a new hash. The browser approval checkbox alone cannot bypass the allowlist. Never use patient or confidential documents.
4. `IPFS_API_TOKEN` is a separate random service credential, not the Pinata JWT. The prepared profile reuses the existing matching backend/Vite operator token. If generating a replacement, use the following from `backend/component1-traceability/`; it writes a random 256-bit token only to the ignored profile and prints no value. Then manually copy that operator value in your editor to the server-only `IPFS_API_TOKEN` in ignored `frontend/.env.local` before restarting frontend services. Leave the mock backend profile unchanged and restore the frontend token when returning to mock mode. Rotation is unnecessary for this prepared profile.

   ```powershell
   @'
   const fs = require('node:fs'), crypto = require('node:crypto');
   const file = '.env.pinata.local';
   const text = fs.readFileSync(file, 'utf8');
   if (!/^IPFS_API_TOKEN=.*$/m.test(text)) throw new Error('Missing operator setting');
   fs.writeFileSync(file, text.replace(/^IPFS_API_TOKEN=.*$/m, 'IPFS_API_TOKEN=' + crypto.randomBytes(32).toString('hex')));
   '@ | node
   ```

5. Confirm ignore status without displaying configuration contents:

   ```powershell
   git check-ignore backend/component1-traceability/.env.pinata.local backend/component1-traceability/.env frontend/.env.local
   ```

After a separate decision to switch the API, stop only the mock backend terminal with Ctrl+C. Do not stop or restart Hardhat. From `backend/component1-traceability/`, start the prepared profile:

```powershell
node --env-file=.env.pinata.local server.js
```

Both profiles use port 5001, so run only one backend at a time. The existing frontend gateway continues to use that port and the same operator token. Never place a provider JWT in a shell environment that also launches Vite. Existing shell environment variables override Node env-file values; use a fresh terminal without conflicting IPFS variables. The frontend remains at `/traceability.html`. Starting a service does not upload files; do not submit any upload until explicit publication approval. Registration continues to store CID references, not PDF bytes, on the existing local contract.

To return to the unchanged mock setup, stop the real backend, then from the repository root run `node integration/component1-local/start-backend.js`. No blockchain redeployment or reset is involved.

Offline checks (no provider credentials or public uploads): from `backend/component1-traceability/`, run `node --test --experimental-test-isolation=none --test-concurrency=1 tests/documents.test.js`; from `frontend/`, run `node --test --experimental-test-isolation=none --test-concurrency=1 src/component1/gateway.test.js`. These mock provider responses and are not proof that the real JWT works.

Configuration-preparation verification: backend document tests **10 passed, 0 failed**; frontend gateway security tests **10 passed, 0 failed**. No real provider authentication, pinning or gateway availability was tested and no documents were published.

## Mandatory public-content review

**Public IPFS must never receive patient or confidential information.** An operator must review and sanitize the exact document, including embedded metadata, images, attachments and text, before allowlisting its SHA-256 in `IPFS_APPROVED_SHA256` (comma-separated hexadecimal hashes). On Windows use `Get-FileHash -Algorithm SHA256 -LiteralPath <file>`. Only approved exact bytes may leave this server. Leave the allowlist empty to prohibit publication. The uploader also explicitly attests `publicApproved=true`.

This is an operational review gate, not automatic sensitive-data detection or malware scanning. File signatures do not prove the entire file is safe. Review batch identifiers too: metadata IDs must be public, never patient identifiers. Only `batchId`, `documentType` and the attestation are accepted; original filenames and metadata are not sent to the pinning provider. Publication can be permanent despite unpinning; do not use confidential documents even encrypted.

## Upload

`POST /api/v1/traceability/documents` with `Authorization: Bearer <IPFS_API_TOKEN>` and multipart form data:

| Field | Value |
| --- | --- |
| `file` | Exactly one nonempty PDF, PNG or JPEG, maximum 5 MiB |
| `batchId` | Public batch key: 1–128 ASCII letters/digits, dot, underscore or hyphen; first character alphanumeric |
| `documentType` | `medicine-certificate` or `laboratory-report` |
| `publicApproved` | Literal string `true` |

MIME type, filename extension and file signature must agree. JSON, scripts, archives, SVG and additional fields are rejected. Files stay in bounded memory; no temporary files are written by the application. Limits: one file, three metadata fields, 256 bytes per metadata field, 20 authorized document requests/minute and two active requests **per service instance**. For multi-instance deployment apply shared rate controls at the proxy. Provider operations time out after 30 seconds. The API does not retry automatically: a timeout may occur after a provider has pinned content; inspect the provider dashboard before retrying.

Successful response: `{success:true,data:{cid,reference,sha256,documentType,batchId,size}}`. `reference` is `ipfs://<CIDv1>`. A provider success confirms pinning according to that provider, not permanent availability. The local SHA-256 describes the uploaded bytes; it is distinct from a UnixFS/dag-pb CID.

## Register a batch

Upload the certificate and laboratory report first. Copy the certificate response's `reference` into `batch.certificateReference`; copy the report's `reference` into `batch.documentReference`. Then use the existing `POST /api/v1/traceability/batches/transactions/register` with `{sender,batch}`. Registration checks both references and canonicalizes CIDv0/v1 to CIDv1 `ipfs://` URIs before ABI encoding. No Solidity or shared schema changes are needed; wallet signing is unchanged.

Bare CIDs and `ipfs://CID` are supported. Only SHA-256 raw and dag-pb CIDs are accepted. HTTP URLs, CID paths, queries, fragments and malformed CIDs are rejected. This tightens Phase 3's opaque-reference behavior. Upload metadata is returned for caller-side matching; it is not a durable association or proof. Existing externally pinned CIDs remain usable; registration does not require a local upload or prove document type, batch association, pin status or authenticity.

## Retrieve safely

`GET /api/v1/traceability/documents/:cid` requires the same operator token. Supply a bare CID. The service fetches only from the configured gateway, rejects redirects and enforces a 5 MiB response limit even without Content-Length. Supported document signatures are checked; responses use `application/octet-stream`, a fixed attachment filename, `nosniff`, `no-store`, and a sandbox CSP. Nothing is rendered inline. The proxy does not accept caller URLs or forward caller authorization to the gateway.

Gateway bytes are untrusted: this service does not reconstruct UnixFS DAGs to independently verify gateway content against the CID. Do not open downloaded documents in an untrusted viewer or treat successful retrieval as validation. **A CID is a content address, not proof of issuer identity, laboratory accreditation, document authenticity or medicine safety.** Those need independent verification and appropriate issuer signatures. Authorization protects API resources, not publicly pinned content.

## Errors and testing

400: invalid metadata, file or CID; 401: invalid/missing operator token; 403: bytes absent from approved-public allowlist; 413: oversized upload; 429: request/concurrency limits; 502: failed or malformed provider/gateway response; 503: document API disabled. Error bodies never include raw provider messages or credentials.

Run `npm test` from Component 1. Tests mock external fetch and exercise multipart requests, public-content approval, file/metadata validation, pin confirmations, provider error redaction, bounded retrieval, attachment headers, CID parsing, registration integration, authentication and rate limits. No provider credential is needed and no public IPFS upload occurs.
