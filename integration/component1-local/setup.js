const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { ROOT, RUNTIME, RPC, MARKER, runtime, readConfig, checkChain, loadHardhat, fixtures } = require('./common');
async function main() {
  const backendFile = path.join(ROOT, 'backend/component1-traceability/.env');
  const frontendFile = path.join(ROOT, 'frontend/.env.local');
  for (const file of [backendFile, frontendFile]) if (fs.existsSync(file)) readConfig(file);
  await checkChain(); const hre = loadHardhat(); runtime();
  const artifact = await hre.artifacts.readArtifact('MedicineTraceability');
  assert.deepEqual(artifact.abi, require('../../shared/abis/MedicineTraceability.json').abi);
  const deploy = require('../../blockchain/scripts/deploy/deploy_traceability');
  const setupRoles = require('../../blockchain/scripts/interactions/setup_traceability_roles');
  const addressFile = path.join(RUNTIME, 'addresses.json'), abiFile = path.join(RUNTIME, 'MedicineTraceability.json');
  const recordFile = path.join(RUNTIME, 'deployment.json');
  let contractAddress, blockNumber;
  if (fs.existsSync(recordFile)) {
    const previous = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    const receipt = await hre.ethers.provider.getTransactionReceipt(previous.transactionHash);
    const code = await hre.ethers.provider.getCode(previous.contractAddress);
    if (receipt?.status === 1 && code.toLowerCase() === artifact.deployedBytecode.toLowerCase()) {
      contractAddress = previous.contractAddress; blockNumber = previous.blockNumber;
    }
  }
  const signers = await hre.ethers.getSigners();
  if (signers.length < 5) throw new Error('Expected disposable local Hardhat accounts.');
  if (!contractAddress) {
    fs.writeFileSync(addressFile, JSON.stringify({ localhost: { MedicineTraceability: '' } }, null, 2));
    const result = await deploy({ hre, env: {}, addressesPath: addressFile, abiPath: abiFile, quiet: true });
    contractAddress = result.contractAddress; blockNumber = result.receipt.blockNumber;
    fs.writeFileSync(recordFile, JSON.stringify({ contractAddress, blockNumber, transactionHash: result.receipt.hash, chainId: 31337 }, null, 2));
  }
  const assignments = { MANUFACTURER_ROLE: [signers[1].address], DISTRIBUTOR_ROLE: [signers[2].address], PHARMACY_ROLE: [signers[3].address], RECALL_ROLE: [signers[4].address] };
  await setupRoles({ hre, env: { CONTRACT_ADDRESS_TRACEABILITY: contractAddress }, assignments, quiet: true });
  fs.writeFileSync(path.join(RUNTIME, 'roles.json'), JSON.stringify(assignments, null, 2));
  const operator = fs.existsSync(backendFile) ? readConfig(backendFile).IPFS_API_TOKEN : randomBytes(32).toString('hex');
  if (!operator || operator.length < 32) throw new Error('Managed operator token missing/invalid.');
  const docs = fixtures(); for (const file of docs) fs.writeFileSync(path.join(RUNTIME, file.name), file.bytes);
  fs.writeFileSync(backendFile, `${MARKER}\nHOST=127.0.0.1\nPORT=5001\nWEB3_RPC_URL=${RPC}\nTRACEABILITY_NETWORK=localhost\nMEDICINE_TRACEABILITY_ADDRESS=${contractAddress}\nIPFS_MOCK_ONLY=true\nIPFS_PROVIDER=mock\nIPFS_PROVIDER_TOKEN=\nIPFS_API_TOKEN=${operator}\nIPFS_APPROVED_SHA256=${docs.map(file => file.sha256).join(',')}\n`, { mode: 0o600 });
  fs.writeFileSync(frontendFile, `${MARKER}\nVITE_TRACEABILITY_ADDRESS=${contractAddress}\nVITE_TRACEABILITY_START_BLOCK=${blockNumber}\nTRACEABILITY_RPC_URL=${RPC}\nIPFS_API_TOKEN=${operator}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ contractAddress, blockNumber, chainId: 31337, roles: assignments, mockDocuments: docs.map(({ name, cid }) => ({ name, cid })), configuration: 'Ignored local files written; no secrets printed; shared registry and ABI untouched.' }, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Local setup failed. Check node readiness, managed configuration, current artifacts and role administrator. No raw provider error is printed.'); process.exitCode = 1; });
module.exports = { main };
