/* Run from blockchain/: node ../integration/component1-evaluation/run.js */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { parseArgs } = require('node:util');
const { summarize, rawCid } = require('./statistics');
const { checkCrossComponent } = require('./cross-component');
const ROOT = path.resolve(__dirname, '../..');
const blockchainRequire = createRequire(path.join(ROOT, 'blockchain/package.json'));
const { createApp } = require('../../backend/component1-traceability/server');
const { TraceabilityClient } = require('../../backend/component1-traceability/blockchain/client');
const { DocumentService } = require('../../backend/component1-traceability/ipfs/documents');
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const digest = value => createHash('sha256').update(value).digest('hex');
function baseCommit() {
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git/HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(head)) return head;
    const ref = /^ref: (refs\/[A-Za-z0-9/_.-]+)$/.exec(head)?.[1];
    if (!ref || ref.includes('..')) return 'unavailable';
    try { const hash = fs.readFileSync(path.join(ROOT, '.git', ref), 'utf8').trim(); if (/^[a-f0-9]{40}$/.test(hash)) return hash; } catch {}
    return fs.readFileSync(path.join(ROOT, '.git/packed-refs'), 'utf8').split(/\r?\n/).find(line => line.endsWith(' ' + ref))?.split(' ')[0] || 'unavailable';
  } catch { return 'unavailable'; }
}

function options(args) {
  const { values } = parseArgs({ args, options: { samples: { type: 'string', default: '10' }, out: { type: 'string', default: 'results/latest' } } });
  const samples = Number(values.samples);
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) throw new Error('--samples must be 1–100.');
  const out = path.resolve(__dirname, values.out);
  if (!out.startsWith(__dirname + path.sep)) throw new Error('--out must stay inside integration/component1-evaluation.');
  return { samples, out };
}
async function listen(server) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
async function evaluate({ samples = 10 } = {}) {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100) throw new Error('Invalid sample count.');
  process.env.HARDHAT_CONFIG = path.join(ROOT, 'blockchain/hardhat.config.js');
  const hre = blockchainRequire('hardhat');
  if (hre.network.name !== 'hardhat') throw new Error('Only a disposable in-process hardhat network is permitted.');
  await hre.network.provider.send('hardhat_reset');
  assert.equal(Number(BigInt(await hre.network.provider.send('eth_chainId'))), 31337);
  const compiled = await hre.artifacts.readArtifact('MedicineTraceability');
  assert.deepEqual(compiled.abi, require('../../shared/abis/MedicineTraceability.json').abi);
  const ui = await import(pathToFileURL(path.join(ROOT, 'frontend/src/component1/client.js')));
  const { documentGateway } = await import(pathToFileURL(path.join(ROOT, 'frontend/component1-document-gateway.js')));
  const [admin, manufacturer, distributor, pharmacy, outsider] = await hre.ethers.getSigners();
  const initial = await hre.ethers.provider.getBlock('latest');
  const startTimestamp = Math.max(1900000000, initial.timestamp + 1);
  await hre.network.provider.send('evm_setNextBlockTimestamp', [startTimestamp]); await hre.network.provider.send('evm_mine');
  const contract = await (await hre.ethers.getContractFactory('MedicineTraceability')).deploy(admin.address); await contract.waitForDeployment();
  for (const [role, wallet] of [['MANUFACTURER', manufacturer], ['DISTRIBUTOR', distributor], ['PHARMACY', pharmacy], ['RECALL', admin]]) await (await contract.grantRole(hre.ethers.id(role + '_ROLE'), wallet.address)).wait();
  const config = { address: await contract.getAddress(), chainId: 31337n };
  const backendRequire = createRequire(path.join(ROOT, 'backend/component1-traceability/package.json'));
  const { BrowserProvider } = backendRequire('ethers');
  const provider = new BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
  const client = new TraceabilityClient({ rpcUrl: 'http://unused.invalid', chainId: 31337, address: config.address }, provider);
  const certificate = Buffer.from('%PDF-1.7\nSYNTHETIC PUBLIC MEDICINE CERTIFICATE\n%%EOF');
  const laboratory = Buffer.from('%PDF-1.7\nSYNTHETIC PUBLIC LABORATORY REPORT\n%%EOF');
  const contents = new Map([[rawCid(certificate), certificate], [rawCid(laboratory), laboratory]]);
  // Synthetic tokens live only in memory and are never written to result artifacts.
  const env = { IPFS_API_TOKEN: 'phase6-synthetic-operator-token-'.repeat(2), IPFS_PROVIDER: 'pinata', IPFS_PROVIDER_TOKEN: 'phase6-synthetic-provider-token', IPFS_APPROVED_SHA256: [certificate, laboratory].map(digest).join(','), VITE_TRACEABILITY_ADDRESS: config.address };
  let pinCalls = 0, backend, rpc, front;
  const transactions = [], rules = [], integrations = [];
  const rpcProvider = hre.network.provider;
  const documents = new DocumentService(env, async (url, request) => {
    if (request.method === 'POST') {
      pinCalls++; const buffer = Buffer.from(await request.body.get('file').arrayBuffer());
      assert.ok(contents.has(rawCid(buffer)));
      return Response.json({ IpfsHash: rawCid(buffer), PinSize: buffer.length, Timestamp: new Date().toISOString() });
    }
    const buffer = contents.get(new URL(url).pathname.split('/').at(-1));
    return buffer ? new Response(buffer) : new Response('', { status: 404 });
  });
  let broadcastStart;
  const ethereum = wallet => ({ request: async ({ method, params }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet.address];
    if (method === 'personal_sign') return wallet.signMessage(hre.ethers.getBytes(params[0]));
    if (method === 'eth_sendTransaction') broadcastStart = performance.now();
    return rpcProvider.send(method, params || []);
  } });
  try {
    backend = createApp({ client, env, documentService: documents });
    const backendUrl = await listen(backend = http.createServer(backend));
    // Real loopback JSON-RPC bridge to the in-process EVM; accepts no external RPC URL.
    rpc = http.createServer(async (req, res) => {
      const chunks = []; for await (const part of req) chunks.push(part);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      const one = async item => { try { return { jsonrpc: '2.0', id: item.id, result: await rpcProvider.send(item.method, item.params || []) }; } catch { return { jsonrpc: '2.0', id: item.id, error: { code: -32000, message: 'Local evaluation RPC failed' } }; } };
      res.setHeader('Content-Type', 'application/json'); res.end(json(Array.isArray(input) ? await Promise.all(input.map(one)) : await one(input)));
    });
    env.TRACEABILITY_RPC_URL = await listen(rpc);
    const gateway = documentGateway(env, { fetcher: (url, request) => fetch(backendUrl + url.pathname, request) });
    const frontUrl = await listen(front = http.createServer((req, res) => gateway(req, res, () => { res.statusCode = 404; res.end(); })));
    const frontendFetch = (url, request) => fetch(frontUrl + url, request);
    const sessions = {};
    for (const [name, wallet] of [['manufacturer', manufacturer], ['distributor', distributor], ['pharmacy', pharmacy]]) sessions[name] = await ui.connectWallet(ethereum(wallet), config);
    const refs = [];
    for (const [documentType, bytes] of [['medicine-certificate', certificate], ['laboratory-report', laboratory]]) {
      refs.push((await ui.documentRequest({ ethereum: ethereum(manufacturer), session: sessions.manufacturer, config,
        file: new File([bytes], 'synthetic.pdf', { type: 'application/pdf' }), documentType, batchId: 'EVALUATION', host: new URL(frontUrl).host, fetcher: frontendFetch })).reference);
    }
    assert.equal(pinCalls, 2);
    const downloaded = await ui.documentRequest({ ethereum: ethereum(pharmacy), session: sessions.pharmacy, config, reference: refs[0], host: new URL(frontUrl).host, fetcher: frontendFetch });
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), certificate);
    integrations.push({ name: 'documents', passed: true, detail: 'Real frontend signing + HTTP gateway + current EVM role checks + backend allowlist and upload/retrieval validation; provider and gateway content delivery mocked; 2 uploads, 1 download.' });
    const request = async (apiPath, body) => ui.api(apiPath, body, (url, init) => fetch(backendUrl + url, init));
    const batch = async (batchId, expiresIn = 3600) => {
      const now = Number(BigInt(await rpcProvider.send('eth_getBlockByNumber', ['latest', false]).then(block => block.timestamp)));
      return { batchId, medicineId: 'SYNTHETIC-MED', name: 'Synthetic medicine', category: 'Research fixture', dosageForm: 'Tablet', strength: '5 mg', manufacturerName: 'Synthetic manufacturer', indication: 'Research only', classification: 'Synthetic', quantity: 100, manufacturedAt: now - 10, expiresAt: now + expiresIn, certificateReference: refs[0], documentReference: refs[1] };
    };
    const state = async id => {
      try { return json({ batch: await contract.getBatch(id), pending: await contract.getPendingTransfer(id), history: await contract.getTransferHistory(id) }); }
      catch (error) { if (contract.interface.parseError(error.data)?.name === 'BatchNotFound') return null; throw error; }
    };
    const endpoint = (id, action) => action === 'register' ? '/batches/transactions/register' : ui.batchPath(id) + '/transactions/' + action;
    async function allow(replica, scenario, id, action, method, args, wallet, body) {
      const before = method === 'registerBatch' ? null : JSON.parse(await state(id));
      const start = performance.now();
      const prepareStart = performance.now();
      const tx = await request(endpoint(id, action), { sender: wallet.address, ...body });
      const prepareMs = performance.now() - prepareStart, walletStart = performance.now(); broadcastStart = undefined;
      try {
        const receipt = await ui.sendPrepared({ ethereum: ethereum(wallet), account: wallet.address, config, tx, expected: { method, args } });
        const confirmed = performance.now(); assert.ok(Number.isFinite(broadcastStart));
        const row = { replica, scenario, method, batchId: id, gasUsed: receipt.gasUsed.toString(), transactionHash: receipt.hash, blockNumber: receipt.blockNumber,
          prepareMs, walletPipelineMs: confirmed - walletStart, broadcastToReceiptMs: confirmed - broadcastStart, endToEndMs: confirmed - start };
        transactions.push(row);
        const after = JSON.parse(await state(id));
        if (method === 'registerBatch') { assert.equal(after.batch[1], wallet.address); assert.equal(after.batch[2], wallet.address); assert.equal(after.batch[3], '0'); }
        if (method === 'initiateTransfer') { assert.equal(after.pending[1], wallet.address); assert.equal(after.pending[2], args[1]); assert.equal(after.batch[2], before.batch[2]); }
        if (method === 'confirmTransfer') { assert.equal(after.batch[2], wallet.address); assert.equal(after.pending[0], '0'); assert.equal(after.history.length, before.history.length + 1); }
        if (method === 'cancelTransfer') { assert.equal(after.pending[0], '0'); assert.equal(after.batch[2], before.batch[2]); }
        if (method === 'recallBatch') { assert.equal(after.batch[4], true); assert.equal(after.batch[2], before.batch[2]); }
        if (before && method !== 'confirmTransfer') assert.equal(after.history.length, before.history.length);
        rules.push({ replica, scenario, expected: 'allow', passed: true });
      } catch (error) { rules.push({ replica, scenario, expected: 'allow', passed: false, detail: error.message }); throw error; }
    }
    async function deny(replica, scenario, id, action, method, args, wallet, body, expectedStatus, expectedError) {
      const before = await state(id); let actual;
      const response = await fetch(backendUrl + ui.BASE + endpoint(id, action), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json({ sender: wallet.address, ...body }) });
      const result = await response.json();
      let evmError;
      try { await contract.connect(wallet)[method].staticCall(...args); }
      catch (error) { evmError = contract.interface.parseError(error.data)?.name; }
      const passed = response.status === expectedStatus && result.error === expectedError && evmError === expectedError && before === await state(id);
      actual = { replica, scenario, expected: 'deny', expectedStatus, expectedError, actualStatus: response.status, apiError: result.error, evmError, passed };
      rules.push(actual); assert.ok(passed, json(actual));
    }
    for (let replica = 1; replica <= samples; replica++) {
      const suffix = String(replica).padStart(3, '0'), flow = 'FLOW-' + suffix, recall = 'RECL-' + suffix, expiry = 'EXPR-' + suffix;
      const flowData = await batch(flow);
      await deny(replica, 'unauthorized_registration', flow, 'register', 'registerBatch', [flowData], outsider, { batch: flowData }, 403, 'AccessControlUnauthorizedAccount');
      await allow(replica, 'register', flow, 'register', 'registerBatch', [flowData], manufacturer, { batch: flowData });
      await deny(replica, 'duplicate_registration', flow, 'register', 'registerBatch', [flowData], manufacturer, { batch: flowData }, 409, 'BatchAlreadyExists');
      await deny(replica, 'unauthorized_owner', flow, 'initiate-transfer', 'initiateTransfer', [flow, distributor.address], outsider, { recipient: distributor.address }, 403, 'NotCurrentOwner');
      await deny(replica, 'skip_distributor', flow, 'initiate-transfer', 'initiateTransfer', [flow, pharmacy.address], manufacturer, { recipient: pharmacy.address }, 403, 'InvalidParticipantRole');
      await deny(replica, 'self_transfer', flow, 'initiate-transfer', 'initiateTransfer', [flow, manufacturer.address], manufacturer, { recipient: manufacturer.address }, 400, 'InvalidRecipient');
      const initiate = (id, actor, recipient) => allow(replica, 'initiate', id, 'initiate-transfer', 'initiateTransfer', [id, recipient.address], actor, { recipient: recipient.address });
      const confirm = (id, actor, transferId) => allow(replica, 'confirm', id, 'confirm-transfer', 'confirmTransfer', [id, transferId], actor, { transferId });
      const cancel = (id, actor, transferId, reject = false) => allow(replica, reject ? 'recipient_rejection' : 'sender_cancellation', id, reject ? 'reject-transfer' : 'cancel-transfer', 'cancelTransfer', [id, transferId], actor, { transferId });
      await initiate(flow, manufacturer, distributor);
      await deny(replica, 'wrong_recipient', flow, 'confirm-transfer', 'confirmTransfer', [flow, '1'], outsider, { transferId: '1' }, 403, 'NotRecipient');
      await deny(replica, 'stale_confirmation', flow, 'confirm-transfer', 'confirmTransfer', [flow, '2'], distributor, { transferId: '2' }, 409, 'StaleTransfer');
      await deny(replica, 'third_party_cancellation', flow, 'cancel-transfer', 'cancelTransfer', [flow, '1'], outsider, { transferId: '1' }, 403, 'NotTransferParticipant');
      await cancel(flow, distributor, '1', true);
      await deny(replica, 'confirm_rejected', flow, 'confirm-transfer', 'confirmTransfer', [flow, '1'], distributor, { transferId: '1' }, 409, 'NoPendingTransfer');
      await initiate(flow, manufacturer, distributor); await cancel(flow, manufacturer, '2');
      await initiate(flow, manufacturer, distributor); await confirm(flow, distributor, '3');
      await deny(replica, 'duplicate_confirmation', flow, 'confirm-transfer', 'confirmTransfer', [flow, '3'], distributor, { transferId: '3' }, 409, 'NoPendingTransfer');
      await deny(replica, 'reverse_transfer', flow, 'initiate-transfer', 'initiateTransfer', [flow, manufacturer.address], distributor, { recipient: manufacturer.address }, 403, 'InvalidParticipantRole');
      await initiate(flow, distributor, pharmacy); await confirm(flow, pharmacy, '4');
      await deny(replica, 'terminal_pharmacy', flow, 'initiate-transfer', 'initiateTransfer', [flow, distributor.address], pharmacy, { recipient: distributor.address }, 409, 'FinalStage');
      const details = await ui.loadBatch(flow, request); assert.equal(details.owner, pharmacy.address); assert.equal(details.history.length, 2);
      const head = Number(BigInt(await rpcProvider.send('eth_blockNumber')));
      assert.ok((await ui.discover(sessions.pharmacy, 0, head)).ids.includes(flow));
      const recallData = await batch(recall);
      await allow(replica, 'register_recall_fixture', recall, 'register', 'registerBatch', [recallData], manufacturer, { batch: recallData });
      await initiate(recall, manufacturer, distributor);
      await deny(replica, 'unauthorized_recall', recall, 'recall', 'recallBatch', [recall, 'Synthetic recall'], outsider, { reason: 'Synthetic recall' }, 403, 'AccessControlUnauthorizedAccount');
      await allow(replica, 'recall_pending', recall, 'recall', 'recallBatch', [recall, 'Synthetic recall'], admin, { reason: 'Synthetic recall' });
      await deny(replica, 'recalled_confirmation', recall, 'confirm-transfer', 'confirmTransfer', [recall, '1'], distributor, { transferId: '1' }, 409, 'BatchRecalled');
      await deny(replica, 'recalled_initiation', recall, 'initiate-transfer', 'initiateTransfer', [recall, distributor.address], manufacturer, { recipient: distributor.address }, 409, 'BatchRecalled');
      await cancel(recall, manufacturer, '1');
      const expiryData = await batch(expiry, 30);
      await allow(replica, 'register_expiry_fixture', expiry, 'register', 'registerBatch', [expiryData], manufacturer, { batch: expiryData }); await initiate(expiry, manufacturer, distributor);
      await rpcProvider.send('evm_setNextBlockTimestamp', [expiryData.expiresAt]); await rpcProvider.send('evm_mine');
      assert.equal((await request(ui.batchPath(expiry) + '/status')).expired, true);
      await deny(replica, 'expired_confirmation_at_boundary', expiry, 'confirm-transfer', 'confirmTransfer', [expiry, '1'], distributor, { transferId: '1' }, 409, 'BatchExpired');
      await deny(replica, 'expired_initiation', expiry, 'initiate-transfer', 'initiateTransfer', [expiry, distributor.address], manufacturer, { recipient: distributor.address }, 409, 'BatchExpired');
      await cancel(expiry, manufacturer, '1');
      console.log(`Replica ${replica}/${samples}: ${transactions.length} confirmed transactions, ${rules.length} rule checks`);
    }
    integrations.push(await checkCrossComponent(hre, contract, { admin, pharmacy }, samples));
    const build = await hre.artifacts.getBuildInfo('contracts/MedicineTraceability.sol:MedicineTraceability');
    const sources = ['blockchain/contracts/MedicineTraceability.sol', 'blockchain/contracts/MedicineRiskRegistry.sol', 'blockchain/contracts/PharmacyTrust.sol', 'blockchain/contracts/PrescriptionRegistry.sol', 'blockchain/package-lock.json', 'backend/component1-traceability/package-lock.json', 'frontend/package-lock.json', 'shared/abis/MedicineTraceability.json', 'backend/component1-traceability/server.js', 'backend/component1-traceability/blockchain/client.js', 'backend/component1-traceability/ipfs/documents.js', 'frontend/src/component1/client.js', 'frontend/component1-document-gateway.js', 'integration/component1-evaluation/run.js', 'integration/component1-evaluation/statistics.js', 'integration/component1-evaluation/cross-component.js'];
    const commit = baseCommit();
    return { methodology: 'Sequential local automined EVM, loopback HTTP backend, real frontend helper calls, synthetic unlocked Hardhat test accounts, mocked pinning/content delivery. No browser/MetaMask/public chain.',
      environment: { collectedAt: new Date().toISOString(), commit, node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), hardhat: blockchainRequire('hardhat/package.json').version, solidity: build.solcLongVersion, compilerSettings: build.input.settings, chainId: 31337, automine: await rpcProvider.send('hardhat_getAutomine'), startTimestamp, replicas: samples, sourceSha256: Object.fromEntries(sources.map(file => [file, digest(fs.readFileSync(path.join(ROOT, file)))])) },
      integrations, transactions, rules, summary: summarize(transactions, rules) };
  } finally { await close(front); await close(backend); await close(rpc); await provider.destroy(); }
}
function writeResults(out, result) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'results.json'), json(result) + '\n');
  const columns = ['replica', 'scenario', 'method', 'batchId', 'gasUsed', 'prepareMs', 'walletPipelineMs', 'broadcastToReceiptMs', 'endToEndMs', 'transactionHash', 'blockNumber'];
  fs.writeFileSync(path.join(out, 'transactions.csv'), [columns.join(','), ...result.transactions.map(row => columns.map(key => row[key]).join(','))].join('\n') + '\n');
  const lines = ['# Component 1 measured local evaluation', '', `Replicas: ${result.environment.replicas}; successful measured transactions: ${result.transactions.length}; rule checks: ${result.rules.length}.`, '', '| Method | n | Gas median | Gas min–max | Prepare median ms | Broadcast→receipt median ms | End-to-end median ms |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const [method, metrics] of Object.entries(result.summary.operations)) lines.push(`| ${method} | ${metrics.gasUsed.n} | ${metrics.gasUsed.median} | ${metrics.gasUsed.min}–${metrics.gasUsed.max} | ${metrics.prepareMs.median.toFixed(3)} | ${metrics.broadcastToReceiptMs.median.toFixed(3)} | ${metrics.endToEndMs.median.toFixed(3)} |`);
  lines.push('', `Scenario enforcement: ${result.summary.rules.all.passed}/${result.summary.rules.all.n} (${(100 * result.summary.rules.all.accuracy).toFixed(2)}%).`, '', 'This is fixture rule-conformance, not counterfeit-detection accuracy, a security proof, throughput, public-chain latency or IPFS performance. See the evaluation README for definitions, exclusions and limitations. Full distributions and provenance are in results.json; each confirmed transaction is in transactions.csv.');
  fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n') + '\n');
}
if (require.main === module) {
  const config = options(process.argv.slice(2));
  evaluate(config).then(result => { writeResults(config.out, result); console.log(`Results saved to ${path.relative(ROOT, config.out)}; ${result.summary.rules.all.passed}/${result.rules.length} checks passed.`); }).catch(error => { console.error('Evaluation failed:', error.message); process.exitCode = 1; });
}
module.exports = { evaluate, writeResults, options };
