# Component 2 MedicineRiskRegistry deployment

This runbook deploys `MedicineRiskRegistry`, exports the ABI consumed by the
Python risk-scoring service, and records persistent deployment addresses in
`shared/blockchain/contract-addresses.json`.

## Prerequisites

From the repository root, install the locked blockchain dependencies:

```bash
cd blockchain
npm ci
```

Never commit RPC credentials, private keys, or a funded development account's
mnemonic. Copy `.env.risk.example` to a local ignored environment file or
export the variables in the current shell.

## Verify before deployment

```bash
npx hardhat test \
  test/component2/MedicineRiskRegistry.test.js \
  test/component2/RiskRegistryDeployment.test.js
```

The tests deploy to Hardhat's ephemeral in-process chain. Ephemeral addresses
are deliberately not written to shared configuration.

## Deploy to a persistent local node

Start a local Hardhat node in one terminal:

```bash
cd blockchain
npx hardhat node
```

In another terminal, set the administrator and deploy:

```bash
cd blockchain
export RISK_REGISTRY_ADMIN=0xYOUR_LOCAL_ADMIN_ADDRESS
npm run deploy:risk:local
```

The command verifies chain ID `31337`, deploys the registry, exports
`shared/blockchain/abi/MedicineRiskRegistry.json`, and writes the deployed
address to the `localhost.MedicineRiskRegistry` slot.

## Deploy to Sepolia

Sepolia deployment is opt-in and requires all of the following values:

```bash
export WEB3_RPC_URL=https://YOUR_SEPOLIA_RPC_URL
export RISK_REGISTRY_PRIVATE_KEY=0xYOUR_32_BYTE_PRIVATE_KEY
export RISK_REGISTRY_ADMIN=0xYOUR_NONZERO_ADMIN_ADDRESS
export RISK_REGISTRY_ALLOW_SEPOLIA=true
cd blockchain
npm run deploy:risk:sepolia
```

The deployment rejects unexpected networks and chain IDs. On success, it
records the address in the `sepolia.MedicineRiskRegistry` slot. The command
does not print provider errors because they can contain RPC credentials.

## Configure the risk-scoring API

Use the same RPC endpoint and the address recorded by the deployment:

```bash
export WEB3_RPC_URL=https://YOUR_RPC_URL
export MEDICINE_RISK_REGISTRY_ADDRESS=0xDEPLOYED_REGISTRY_ADDRESS
```

Start the API and submit a medicine payload plus `sender` to
`POST /api/v1/risk/assess/transaction`. The endpoint returns an unsigned
`setBatchRisk` transaction. The sender's wallet signs and broadcasts it.

The sender must hold `ORACLE_ROLE`. The deployment administrator receives
`DEFAULT_ADMIN_ROLE` and `ORACLE_ROLE` initially and may grant oracle access to
the backend publisher account.

## Deployment output and verification

The deployment prints JSON containing the network, contract address,
administrator, transaction hash, block number, and whether the address was
saved. Verify the following before configuring another component:

1. The receipt status is successful.
2. Contract bytecode exists at the printed address.
3. The address is stored under the correct network.
4. The ABI export matches the compiled contract.
5. The API publisher account has `ORACLE_ROLE`.
