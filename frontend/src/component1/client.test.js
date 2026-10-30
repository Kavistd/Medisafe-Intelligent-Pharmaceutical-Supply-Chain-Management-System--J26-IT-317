import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, getBytes, verifyMessage, sha256 } from 'ethers';
import { settings, selectWalletProvider, watchWallet, connectWallet, iface, verifyPrepared, walletContext, sendPrepared, loadBatch, api, batchPath, registration, discover, documentMessage, documentRequest } from './client.js';
import { EventEmitter } from 'node:events';
const account = '0x1111111111111111111111111111111111111111', address = '0x2222222222222222222222222222222222222222';
const config = { address, chainId: 31337n };
const expected = { method: 'confirmTransfer', args: ['B/ 1', '7'] };
const transaction = { from: account, to: address, chainId: 31337, value: '0x0', data: iface.encodeFunctionData(expected.method, expected.args) };
const ethereum = { request: async ({ method }) => method === 'eth_accounts' ? [account] : '0x7a69' };

test('Component 1 selects MetaMask instead of the global competing wallet and reads its live Sepolia chain', async () => {
  const metamask = { isMetaMask: true, request: async ({ method }) => method === 'eth_accounts' ? [account] : '0xaa36a7' };
  const competing = { request: async () => '0x7a69', providers: [{ request() {} }, metamask] };
  const selected = await selectWalletProvider({ target: { ethereum: competing } });
  assert.equal(selected, metamask);
  await walletContext(selected, account, { ...config, chainId: 11155111n });
});

test('Component 1 prefers EIP-6963 MetaMask identity and rejects ambiguous legacy providers', async () => {
  const metamask = { request() {} }, target = new EventTarget();
  target.addEventListener('eip6963:requestProvider', () => {
    const event = new Event('eip6963:announceProvider');
    event.detail = { info: { rdns: 'io.metamask', name: 'MetaMask' }, provider: metamask }; target.dispatchEvent(event);
  });
  target.ethereum = { request() {}, isMetaMask: true };
  assert.equal(await selectWalletProvider({ target }), metamask);
  await assert.rejects(selectWalletProvider({ target: { ethereum: { providers: [
    { request() {}, isMetaMask: true }, { request() {}, isMetaMask: true },
  ] } } }), /Multiple MetaMask/);
});

test('wallet changes are checked live and diagnostics include actual and expected chain IDs', async () => {
  let chain = '0x7a69';
  const selected = { request: async ({ method }) => method === 'eth_accounts' ? [account] : chain };
  const cfg = { ...config, chainId: 11155111n };
  await assert.rejects(walletContext(selected, account, cfg), /31337.*0x7a69.*11155111/);
  chain = '0xaa36a7'; await walletContext(selected, account, cfg);
  chain = '0x1'; await assert.rejects(walletContext(selected, account, cfg), /chain 1 .*11155111/);
});

test('account, chain and disconnect events are bound to selected provider and cleaned up', () => {
  const selected = new EventEmitter(), competing = new EventEmitter(); let invalidations = 0;
  const unsubscribe = watchWallet(selected, () => invalidations++);
  competing.emit('chainChanged', '0x1'); assert.equal(invalidations, 0);
  selected.emit('accountsChanged', []); selected.emit('chainChanged', '0xaa36a7'); selected.emit('disconnect');
  assert.equal(invalidations, 3); unsubscribe();
  for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) assert.equal(selected.listenerCount(event), 0);
});

test('empty connection and wrong chain are rejected before contract/provider reads', async () => {
  await assert.rejects(connectWallet({ request: async () => [] }, config), /No wallet account connected/);
  await assert.rejects(connectWallet({ request: async ({ method }) => ['eth_requestAccounts', 'eth_accounts'].includes(method) ? [account] : '0x7a69' },
    { ...config, chainId: 11155111n }), /11155111/);
});

test('connection rejects account or chain changes during role loading and retains selected provider on success', async () => {
  for (const change of ['none', 'account', 'chain']) {
    let reads = 0;
    const injected = { request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [reads === 4 && change === 'account' ? address : account];
      if (method === 'eth_chainId') return reads === 4 && change === 'chain' ? '0x7a69' : '0xaa36a7';
      if (method === 'eth_getCode') return '0x6000';
      if (method === 'eth_call') { reads++; return iface.encodeFunctionResult('hasRole', [false]); }
      throw new Error('Unexpected read-only method');
    } };
    const promise = connectWallet(injected, { ...config, chainId: 11155111n });
    if (change === 'none') {
      const session = await promise; assert.equal(session.ethereum, injected); assert.equal(session.account, account);
    } else await assert.rejects(promise, change === 'account' ? /account changed/ : /11155111/);
  }
});

test('network configuration defaults to Hardhat and rejects unsupported networks', () => {
  assert.equal(settings({}).chainId, 31337n);
  assert.equal(settings({ VITE_TRACEABILITY_CHAIN_ID: '11155111' }).chainId, 11155111n);
  for (const value of ['1', '0', 'invalid']) assert.throws(() => settings({ VITE_TRACEABILITY_CHAIN_ID: value }));
});

for (const chainId of [31337n, 11155111n]) test(`wallet and prepared transaction enforce configured chain ${chainId}`, async () => {
  const cfg = { ...config, chainId };
  const other = chainId === 31337n ? 11155111n : 31337n;
  const wallet = chain => ({ request: async ({ method }) => method === 'eth_accounts' ? [account] : '0x' + chain.toString(16) });
  await walletContext(wallet(chainId), account, cfg);
  await assert.rejects(walletContext(wallet(other), account, cfg), new RegExp(String(chainId)));
  verifyPrepared({ ...transaction, chainId }, expected, account, cfg);
  assert.throws(() => verifyPrepared({ ...transaction, chainId: other }, expected, account, cfg));
  const receipt = await sendPrepared({ ethereum: wallet(chainId), account, config: cfg, tx: { ...transaction, chainId }, expected,
    makeProvider: () => ({ getSigner: async () => ({ sendTransaction: async tx => {
      assert.equal(tx.chainId, chainId); return { hash: '0xtest', wait: async () => ({ status: 1 }) };
    } }) }) });
  assert.equal(receipt.status, 1);
});

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
