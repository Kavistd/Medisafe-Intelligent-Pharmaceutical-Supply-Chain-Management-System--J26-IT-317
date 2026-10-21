import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeployment, discoverPublic, batchPage, scanRetryDelay, scanProgress } from './public.js';
const config = { address: '0x1111111111111111111111111111111111111111', chainId: 11155111n, startBlock: 100 };
const metadata = { chainId: 11155111, address: config.address, startBlock: 100, headBlock: 150, nextBlock: 99, complete: true, ids: ['B'], direction: 'backward' };
test('wallet-free discovery validates metadata, deployment block and continuation', async () => {
  assert.throws(() => verifyDeployment({ ...metadata, address: 'bad' }, config));
  await assert.rejects(discoverPublic(config, null, async () => ({ ...metadata, chainId: 1 })));
  const paths = [];
  const request = async path => { paths.push(path); return metadata; };
  assert.equal((await discoverPublic(config, null, request)).complete, true);
  await discoverPublic(config, metadata, request);
  assert.deepEqual(paths, ['/batches?direction=backward', '/batches?fromBlock=99&headBlock=150&direction=backward']);
  await discoverPublic(config, { ...metadata, direction: 'forward' }, request);
  assert.equal(paths.at(-1), '/batches?direction=backward');
  await assert.rejects(discoverPublic(config, null, async () => ({ ...metadata, startBlock: 0 })));
  await assert.rejects(discoverPublic(config, null, async () => { throw new Error('RPC unavailable'); }), /RPC unavailable/);
});
test('transient scan failures retry with a bounded backoff; configuration failures stop', () => {
  const error = new Error('Blockchain request failed. Check RPC configuration and availability.');
  assert.deepEqual([0, 1, 2, 3, 4].map(n => scanRetryDelay(error, n)), [1000, 2000, 4000, 8000, null]);
  assert.equal(scanRetryDelay(new TypeError('Failed to fetch'), 0), 1000);
  assert.equal(scanRetryDelay(new Error('Network or contract does not match this application.'), 0), null);
});
test('newest-first progress never labels a partial registry complete', () => {
  assert.match(scanProgress(null), /incomplete/);
  assert.match(scanProgress({ direction: 'backward', startBlock: 100, headBlock: 199, fromBlock: 190, complete: false }), /10 of 100 blocks \(10%\).*incomplete/);
  assert.match(scanProgress({ direction: 'backward', headBlock: 199, complete: true }), /Complete through block 199/);
});
test('list keeps transferred records, filters discovered IDs/names/stages and paginates safely', () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ data: { batchId: `B-${i}`, name: 'Amoxicillin' }, owner: 'current-owner', stage: String(i % 3) }));
  assert.equal(batchPage(rows, '', '', 1).rows.length, 10);
  assert.equal(batchPage(rows, '', '', 3).rows.length, 3);
  assert.equal(batchPage(rows, '', '2', 1).count, 7);
  assert.equal(batchPage(rows, 'amoxicillin', '', 1).count, 23);
  assert.equal(batchPage(rows, 'missing', '', 9).page, 1);
});
