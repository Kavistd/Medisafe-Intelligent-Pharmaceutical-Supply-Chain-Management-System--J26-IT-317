import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, getBytes, verifyMessage, sha256 } from 'ethers';
import { iface, verifyPrepared, walletContext, sendPrepared, loadBatch, api, batchPath, registration, discover, documentMessage, documentRequest } from './client.js';
const account = '0x1111111111111111111111111111111111111111', address = '0x2222222222222222222222222222222222222222';
const config = { address, chainId: 31337n };
const expected = { method: 'confirmTransfer', args: ['B/ 1', '7'] };
const transaction = { from: account, to: address, chainId: 31337, value: '0x0', data: iface.encodeFunctionData(expected.method, expected.args) };
const ethereum = { request: async ({ method }) => method === 'eth_accounts' ? [account] : '0x7a69' };

test('ABI calldata verification rejects wrong destination, sender, network, value and intent', () => {
  verifyPrepared(transaction, expected, account, config);
  for (const changes of [{ to: account }, { from: address }, { chainId: 1 }, { value: '1' }, { data: iface.encodeFunctionData('cancelTransfer', expected.args) }, { data: '0x1234' }]) assert.throws(() => verifyPrepared({ ...transaction, ...changes }, expected, account, config));
});
test('wallet context rejects disconnected/changed accounts and wrong chain', async () => {
  await walletContext(ethereum, account, config);
  for (const [accounts, chain] of [[[], '0x7a69'], [[address], '0x7a69'], [[account], '0x1']]) await assert.rejects(walletContext({ request: async ({ method }) => method === 'eth_accounts' ? accounts : chain }, account, config));
});
test('transaction remains pending until confirmed and never forwards server gas limits', async () => {
  const events = [];
  const receipt = { status: 1, blockNumber: 4 };
  const result = await sendPrepared({ ethereum, account, config, tx: { ...transaction, gasLimit: '1' }, expected,
    onPending: hash => events.push(hash), makeProvider: () => ({ getSigner: async () => ({ sendTransaction: async tx => {
      assert.equal(tx.gasLimit, undefined); assert.equal(tx.value, 0n);
      return { hash: '0xabc', wait: async () => { assert.deepEqual(events, ['0xabc']); return receipt; } };
    } }) }) });
  assert.equal(result, receipt);
});
test('tampered prepared transactions cannot reach wallet signing', async () => {
  let called = false;
  await assert.rejects(sendPrepared({ ethereum, account, config, tx: { ...transaction, value: 1 }, expected, makeProvider: () => { called = true; } }));
  assert.equal(called, false);
});
test('failed receipts do not report success and wallet rejections propagate', async () => {
  for (const reject of [false, true]) await assert.rejects(sendPrepared({ ethereum, account, config, tx: transaction, expected, makeProvider: () => ({ getSigner: async () => ({ sendTransaction: async () => {
    if (reject) throw new Error('Rejected');
    return { hash: '0xabc', wait: async () => ({ status: 0 }) };
  } }) }) }));
});
test('tracking uses existing encoded paths and unwraps positional API outputs', async () => {
  const paths = [];
  const result = await loadBatch('B/ 1', async path => {
    paths.push(path);
    if (path.endsWith('/status')) return { expired: true };
    if (path.endsWith('/history')) return { '0': [{ id: '1' }] };
    if (path.endsWith('/pending-transfer')) return { '0': { id: '0' } };
    return { '0': { owner: account, data: { batchId: 'B/ 1' } } };
  });
  assert.equal(paths[0], '/batches/B%2F%201'); assert.equal(result.expired, true); assert.equal(result.history.length, 1);
  assert.equal(batchPath(' B '), '/batches/%20B%20');
});
test('API errors and empty data remain explicit', async () => {
  await assert.rejects(api('/batches/no', undefined, async () => ({ ok: false, json: async () => ({ message: 'Batch not found' }) })), /Batch not found/);
});
test('registration preserves exact IDs and converts local dates to safe Unix seconds', () => {
  const result = registration({ batchId: ' B ', quantity: '5', manufacturedAt: '2026-01-01T10:00', expiresAt: '2027-01-01T10:00' });
  assert.equal(result.batchId, ' B '); assert.equal(result.quantity, 5); assert.ok(Number.isSafeInteger(result.expiresAt));
  for (const quantity of ['0', '1.5', '9007199254740992', 'not a number']) assert.throws(() => registration({ quantity, manufacturedAt: '2026-01-01', expiresAt: '2027-01-01' }));
  assert.throws(() => registration({ quantity: 1, manufacturedAt: '2027-01-01', expiresAt: '2026-01-01' }));
});
test('event discovery uses actual events and bounded block windows', async () => {
  const event = iface.encodeEventLog(iface.getEvent('TransferInitiated'), ['0x' + '00'.repeat(32), 'B-1', 7, address, account, 1]);
  const session = { account, contract: { getAddress: async () => address }, provider: { getLogs: async filter => {
    assert.equal(filter.fromBlock, 100); assert.equal(filter.toBlock, 1099); assert.equal(filter.address, address);
    return [event];
  } } };
  assert.deepEqual(await discover(session, 100, 9000), { ids: ['B-1'], nextBlock: 1100 });
});
test('signed document intent includes domain, chain, registry, body and freshness', () => {
  const message = documentMessage({ host: 'localhost:5173', method: 'POST', path: '/api/v1/traceability/documents', digest: 'digest', timestamp: 'time', nonce: 'nonce', address });
  for (const value of ['localhost:5173', '31337', address, 'digest', 'time', 'nonce', 'POST']) assert.ok(message.includes(value));
});

test('browser upload binds the exact multipart bytes and never sends an operator token', async () => {
  const wallet = Wallet.createRandom(); let signedMessage;
  const injected = { request: async ({ method, params }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet.address];
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'personal_sign') { signedMessage = Buffer.from(getBytes(params[0])).toString(); return wallet.signMessage(getBytes(params[0])); }
    throw new Error('Unexpected wallet request: ' + method);
  } };
  const result = await documentRequest({ ethereum: injected, session: { account: wallet.address }, config, host: 'localhost:5173',
    file: new File(['%PDF-1.7 synthetic public file'], 'public.pdf', { type: 'application/pdf' }), documentType: 'medicine-certificate', batchId: 'B-1',
    fetcher: async (path, options) => {
      assert.equal(path, '/api/v1/traceability/documents');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(verifyMessage(signedMessage, options.headers['X-Document-Signature']), wallet.address);
      assert.ok(signedMessage.includes(sha256(options.body)));
      const parsed = await new Request('http://localhost', options).formData();
      assert.equal(parsed.get('batchId'), 'B-1'); assert.equal(parsed.get('publicApproved'), 'true');
      assert.equal(parsed.get('file').name, 'public.pdf');
      return Response.json({ success: true, data: { reference: 'ipfs://fixture' } });
    } });
  assert.equal(result.reference, 'ipfs://fixture');
});
