const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { TraceabilityClient, contractInterface: iface, loadSettings, publicError } = require('../blockchain/client');
const validate = require('../validators/requests');
const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const batch = { batchId: ' B-1 ', medicineId: 'M', name: 'Medicine', category: 'Category', dosageForm: 'Tablet', strength: '5 mg', manufacturerName: 'Maker', indication: 'Indication', classification: 'Prescription', quantity: 10, manufacturedAt: 100, expiresAt: 200, documentReference: 'ipfs://document', certificateReference: 'ipfs://certificate' };
function fixture() {
  const calls = [];
  const settings = { rpcUrl: 'http://localhost:8545', chainId: 31337, address: recipient };
  const provider = {
    send: async () => '0x7a69', getCode: async () => '0x1234',
    call: async tx => {
      const decoded = iface.parseTransaction(tx); calls.push({ tx, decoded });
      switch (decoded.name) {
        case 'getBatch': return iface.encodeFunctionResult('getBatch', [[batch, sender, sender, 0, false]]);
        case 'getPendingTransfer': return iface.encodeFunctionResult('getPendingTransfer', [[1, sender, recipient, 1, 100]]);
        case 'getTransferHistory': return iface.encodeFunctionResult('getTransferHistory', [[[1, sender, recipient, 1, 100, 110]]]);
        case 'isBatchExpired': return iface.encodeFunctionResult('isBatchExpired', [false]);
        default: return '0x';
      }
    }, estimateGas: async () => 50000n,
  };
  return { calls, provider, client: new TraceabilityClient(settings, provider) };
}
async function serve(client, run) {
  const server = createApp({ client }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await run(async (path, body) => {
    const response = await fetch(url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }); } finally { await new Promise(resolve => server.close(resolve)); }
}
const base = '/api/v1/traceability/batches';

test('reads ABI-encoded batch, ownership, pending transfer, history and safety status', async () => {
  await serve(fixture().client, async request => {
    const result = await request(`${base}/B-1`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data['0'].owner, sender);
    assert.equal(result.body.data['0'].data.quantity, '10');
    assert.equal((await request(`${base}/B-1/pending-transfer`)).body.data['0'].id, '1');
    assert.equal((await request(`${base}/B-1/history`)).body.data['0'][0].confirmedAt, '110');
    assert.deepEqual((await request(`${base}/B-1/status`)).body.data, { batchId: 'B-1', recalled: false, expired: false });
  });
});

test('every write prepares actual ABI calldata without signing or broadcasting', async () => {
  const f = fixture();
  await serve(f.client, async request => {
    const cases = [
      [`${base}/transactions/register`, { sender, batch }, 'registerBatch'],
      [`${base}/B-1/transactions/initiate-transfer`, { sender, recipient }, 'initiateTransfer'],
      [`${base}/B-1/transactions/confirm-transfer`, { sender: recipient, transferId: '1' }, 'confirmTransfer'],
      [`${base}/B-1/transactions/cancel-transfer`, { sender, transferId: '1' }, 'cancelTransfer'],
      [`${base}/B-1/transactions/reject-transfer`, { sender: recipient, transferId: '1' }, 'cancelTransfer'],
      [`${base}/B-1/transactions/recall`, { sender, reason: 'Safety recall' }, 'recallBatch'],
    ];
    for (const [path, body, method] of cases) {
      const result = await request(path, body);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const tx = result.body.data;
      assert.equal(iface.parseTransaction(tx).name, method);
      assert.equal(tx.from, body.sender); assert.equal(tx.to, recipient);
      assert.equal(tx.chainId, 31337); assert.equal(tx.value, '0x0');
      assert.equal(tx.gasLimit, '50000');
      if (method === 'registerBatch') assert.equal(iface.parseTransaction(tx).args[0].batchId, ' B-1 ');
    }
    assert.equal((await request(`${base}/B-1/transactions/reject-transfer`, { sender, transferId: '1' })).status, 403);
  });
});

test('schema rejects missing, extra, unsafe, coerced and invalid batch fields', () => {
  assert.equal(validate.registration(batch).batchId, ' B-1 ');
  for (const invalid of [null, {}, { ...batch, owner: sender }, { ...batch, quantity: '10' }, { ...batch, quantity: 2 ** 53 }, { ...batch, name: '\t ' }, { ...batch, expiresAt: 1 }]) {
    assert.throws(() => validate.registration(invalid), { code: 'VALIDATION_ERROR' });
  }
  for (const id of ['0', '-1', '1.1', 1, (2n ** 256n).toString()]) assert.throws(() => validate.transferId(id));
  assert.equal(validate.transferId((2n ** 256n - 1n).toString()), (2n ** 256n - 1n).toString());
});

test('invalid transaction requests cannot reach RPC', async () => {
  const f = fixture();
  await serve(f.client, async request => {
    for (const body of [{ sender: 'invalid', batch }, { sender, batch, privateKey: 'secret' }, { sender, batch: {} }]) {
      assert.equal((await request(`${base}/transactions/register`, body)).status, 400);
    }
    assert.equal((await request(`${base}/B/transactions/confirm-transfer`, { sender, transferId: 1 })).status, 400);
  });
  assert.equal(f.calls.length, 0);
});

test('real ABI contract reverts map to stable HTTP errors and prevent preparation', async () => {
  for (const [name, args, expected] of [
    ['BatchNotFound', ['missing'], 404], ['AccessControlUnauthorizedAccount', [sender, '0x' + '00'.repeat(32)], 403],
    ['NotRecipient', [], 403], ['StaleTransfer', [], 409], ['BatchExpired', [], 409], ['BatchRecalled', [], 409], ['InvalidField', ['expiresAt'], 400],
  ]) {
    const f = fixture(); let estimated = false;
    f.provider.call = async () => { throw { data: iface.encodeErrorResult(name, args) }; };
    f.provider.estimateGas = async () => { estimated = true; return 1n; };
    await serve(f.client, async request => {
      const result = await request(`${base}/B/transactions/recall`, { sender, reason: 'Recall' });
      assert.equal(result.status, expected); assert.equal(result.body.error, name);
    });
    assert.equal(estimated, false);
  }
});

test('wrong chain, missing bytecode and RPC failures fail closed without leaking details', async () => {
  for (const mode of ['chain', 'code', 'rpc']) {
    const f = fixture();
    if (mode === 'chain') f.provider.send = async () => '0x1';
    if (mode === 'code') f.provider.getCode = async () => '0x';
    if (mode === 'rpc') f.provider.send = async () => { throw new Error('https://secret-token@provider'); };
    await serve(f.client, async request => {
      const result = await request('/health/blockchain');
      assert.equal(result.status, 503); assert.ok(!JSON.stringify(result.body).includes('secret-token'));
    });
  }
  assert.equal(publicError(new Error('secret')).code, 'BLOCKCHAIN_UNAVAILABLE');
});

test('settings reject absent address, unsupported network and non-HTTP RPC', () => {
  for (const env of [{}, { TRACEABILITY_NETWORK: 'mainnet' }, { WEB3_RPC_URL: 'file:///tmp', MEDICINE_TRACEABILITY_ADDRESS: sender }]) assert.throws(() => loadSettings(env));
  assert.equal(loadSettings({ WEB3_RPC_URL: 'http://localhost:8545', MEDICINE_TRACEABILITY_ADDRESS: sender }).chainId, 31337);
});

test('HTTP boundary handles malformed JSON, body limits and absent routes', async () => {
  const server = createApp({ client: fixture().client }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(url + '/absent')).status, 404);
    for (const [body, status] of [['{', 400], [JSON.stringify({ value: 'x'.repeat(40000) }), 413]]) {
      const result = await fetch(url + base + '/transactions/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(result.status, status);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
