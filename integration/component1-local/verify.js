const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { ROOT, RUNTIME, RPC, readConfig, checkChain, loadHardhat, fixtures } = require('./common');
async function main() {
  await checkChain(); const hre = loadHardhat();
  const backend = readConfig(path.join(ROOT, 'backend/component1-traceability/.env'));
  const frontend = readConfig(path.join(ROOT, 'frontend/.env.local'));
  const deployment = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'deployment.json'), 'utf8'));
  assert.equal(frontend.VITE_TRACEABILITY_ADDRESS, deployment.contractAddress);
  assert.equal(backend.MEDICINE_TRACEABILITY_ADDRESS, deployment.contractAddress);
  assert.equal(backend.WEB3_RPC_URL, RPC); assert.equal(frontend.TRACEABILITY_RPC_URL, RPC);
  assert.equal(frontend.IPFS_API_TOKEN, backend.IPFS_API_TOKEN);
  const artifact = await hre.artifacts.readArtifact('MedicineTraceability');
  assert.deepEqual(artifact.abi, require('../../shared/abis/MedicineTraceability.json').abi);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(RUNTIME, 'MedicineTraceability.json'), 'utf8')).abi, artifact.abi);
  assert.equal((await hre.ethers.provider.getCode(deployment.contractAddress)).toLowerCase(), artifact.deployedBytecode.toLowerCase());
  const contract = await hre.ethers.getContractAt('MedicineTraceability', deployment.contractAddress);
  const roles = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'roles.json'), 'utf8'));
  for (const [role, accounts] of Object.entries(roles)) for (const account of accounts) assert.equal(await contract.hasRole(await contract[role](), account), true);
  for (const endpoint of ['/health', '/health/blockchain']) assert.equal((await fetch('http://127.0.0.1:5001' + endpoint)).status, 200);
  for (const [endpoint, entry] of [['/traceability.html', '/src/component1/main.jsx'], ['/', '/src/main.jsx']]) {
    const response = await fetch('http://127.0.0.1:5173' + endpoint); assert.equal(response.status, 200); assert.ok((await response.text()).includes(entry));
  }
  assert.equal((await fetch('http://127.0.0.1:5173/api/v1/traceability/documents', { method: 'POST' })).status, 401);
  const ui = await import(pathToFileURL(path.join(ROOT, 'frontend/src/component1/client.js')));
  const signers = await hre.ethers.getSigners();
  const injected = wallet => ({ request: async ({ method, params }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet.address];
    if (method === 'personal_sign') return wallet.signMessage(hre.ethers.getBytes(params[0]));
    return hre.network.provider.send(method, params || []);
  } });
  const config = { address: deployment.contractAddress, chainId: 31337n };
  const request = input => ui.documentRequest({ ...input, config, host: '127.0.0.1:5173', fetcher: (url, options) => fetch('http://127.0.0.1:5173' + url, options) });
  const manufacturer = await ui.connectWallet(injected(signers[1]), config);
  const pharmacy = await ui.connectWallet(injected(signers[3]), config);
  for (const file of fixtures()) {
    const result = await request({ ethereum: injected(signers[1]), session: manufacturer, file: new File([file.bytes], file.name, { type: 'application/pdf' }), documentType: file.name === 'certificate.pdf' ? 'medicine-certificate' : 'laboratory-report', batchId: 'LOCAL-SETUP-CHECK' });
    assert.equal(result.reference, 'ipfs://' + file.cid);
    const blob = await request({ ethereum: injected(signers[3]), session: pharmacy, reference: result.reference });
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), file.bytes);
  }
  console.log('PASS live local setup: chain, exact bytecode/ABI, addresses, roles, API health, both page entry points, unsigned document denial and two mock upload/download round trips.');
  console.log('No browser or MetaMask verification claimed; Component 4 backend/contract workflows are not verified.');
}
if (require.main === module) main().catch(() => { console.error('Local verification failed. Check chain, managed configuration, backend/frontend processes and document rate limits. No credentials are printed.'); process.exitCode = 1; });
