const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TraceabilityClient, contractInterface: iface, publicError } = require('../blockchain/client');
const { createApp } = require('../server');
const address = '0x1111111111111111111111111111111111111111';
function fixture() {
  const ranges = [];
  const event = iface.encodeEventLog(iface.getEvent('BatchRegistered'), ['0x' + '01'.repeat(32), 'TRANSFERRED-BATCH', address]);
  const provider = { send: async () => '0xaa36a7', getCode: async () => '0x1234', getBlockNumber: async () => 2500,
    getLogs: async range => { ranges.push(range); return [event, event, { ...event, removed: true }]; } };
  return { provider, ranges, client: new TraceabilityClient({ rpcUrl: 'http://localhost', chainId: 11155111, address, startBlock: 100 }, provider) };
}
test('registration discovery is wallet-free, deduplicated, bounded and independent of current custody', async () => {
  const f = fixture();
  const first = await f.client.discovery();
  assert.deepEqual(first.ids, ['TRANSFERRED-BATCH']);
  assert.equal(first.nextBlock, 1100); assert.equal(first.complete, false);
  assert.equal(f.ranges[0].address, address);
  assert.deepEqual(f.ranges[0].topics, [iface.getEvent('BatchRegistered').topicHash]);
  const last = await f.client.discovery({ fromBlock: '2100', headBlock: '2500' });
  assert.equal(last.complete, true); assert.equal(last.nextBlock, 2501);
  const calls = f.ranges.length;
  assert.deepEqual((await f.client.discovery({ fromBlock: '2501', headBlock: '2500' })).ids, []);
  assert.equal(f.ranges.length, calls);
});
test('range-limited RPC queries shrink without skipping blocks; single-block failure propagates', async () => {
  const f = fixture(); const ranges = [];
  f.provider.getLogs = async range => { ranges.push(range); if (range.toBlock - range.fromBlock > 9) throw { code: -32005 }; return []; };
  const result = await f.client.discovery();
  assert.equal(result.fromBlock, 100); assert.ok(result.toBlock < 110); assert.equal(result.nextBlock, result.toBlock + 1);
  assert.ok(ranges.every(range => range.fromBlock === 100));
  const continued = await f.client.discovery({ fromBlock: String(result.nextBlock), headBlock: String(result.headBlock), windowSize: String(result.windowSize) });
  assert.equal(continued.fromBlock, result.nextBlock);
  for (const windowSize of ['0', '1001', '-1', '1.5']) await assert.rejects(f.client.discovery({ windowSize }), { code: 'VALIDATION_ERROR' });
  f.provider.getLogs = async () => { throw { code: -32005 }; };
  await assert.rejects(f.client.discovery());
});
test('invalid cursors, wrong chains and RPC failures fail closed', async () => {
  const f = fixture();
  for (const query of [{ fromBlock: '-1' }, { fromBlock: '1.5' }, { fromBlock: '99' }, { headBlock: '2501' }, { fromBlock: '2600' }]) await assert.rejects(f.client.discovery(query), { code: 'VALIDATION_ERROR' });
  f.provider.send = async () => '0x1';
  await assert.rejects(f.client.discovery(), { code: 'CHAIN_MISMATCH' });
  f.provider.send = async () => '0xaa36a7'; let attempts = 0;
  f.provider.getLogs = async () => { attempts++; throw new Error('RPC credential must not leak'); };
  try { await f.client.discovery(); } catch (error) { assert.ok(!publicError(error).message.includes('credential')); }
  assert.equal(attempts, 1);
});
test('public discovery endpoint accepts only bounded cursor parameters and requires no authentication', async () => {
  const f = fixture(); const server = createApp({ client: f.client }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v1/traceability/batches`;
    const response = await fetch(base); assert.equal(response.status, 200);
    assert.equal((await response.json()).data.chainId, 11155111);
    const network = await fetch(base.replace('/batches', '/network'));
    assert.deepEqual((await network.json()).data, { chainId: 11155111, address, startBlock: 100, headBlock: 2500 });
    for (const query of ['?rpcUrl=secret', '?fromBlock[]=100', '?fromBlock=100&fromBlock=200']) assert.equal((await fetch(base + query)).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('newest-first discovery finds recent batches immediately and covers older ranges without gaps', async () => {
  const f = fixture();
  const first = await f.client.discovery({ direction: 'backward' });
  assert.deepEqual(first.ids, ['TRANSFERRED-BATCH']);
  assert.equal(first.fromBlock, 1501); assert.equal(first.toBlock, 2500);
  assert.equal(first.nextBlock, 1500); assert.equal(first.complete, false);
  const second = await f.client.discovery({ direction: 'backward', fromBlock: '1500', headBlock: '2500', windowSize: '1000' });
  assert.equal(second.toBlock, first.fromBlock - 1); assert.equal(second.fromBlock, 501);
  const last = await f.client.discovery({ direction: 'backward', fromBlock: '500', headBlock: '2500' });
  assert.equal(last.fromBlock, 100); assert.equal(last.complete, true);
  await assert.rejects(f.client.discovery({ direction: 'sideways' }), { code: 'VALIDATION_ERROR' });
  f.client.settings.startBlock = 3000;
  const empty = await f.client.discovery({ direction: 'backward' });
  assert.equal(empty.complete, true); assert.deepEqual(empty.ids, []);
});
test('newest-first range-limit adaptation preserves the upper boundary and cursor', async () => {
  const f = fixture();
  f.provider.getLogs = async range => { if (range.toBlock - range.fromBlock > 9) throw { code: -32005 }; return []; };
  const result = await f.client.discovery({ direction: 'backward' });
  assert.equal(result.toBlock, 2500); assert.ok(result.fromBlock >= 2491);
  assert.equal(result.nextBlock, result.fromBlock - 1);
  const next = await f.client.discovery({ direction: 'backward', fromBlock: String(result.nextBlock), headBlock: '2500', windowSize: String(result.windowSize) });
  assert.equal(next.toBlock, result.fromBlock - 1);
});
