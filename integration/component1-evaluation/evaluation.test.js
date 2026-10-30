const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, options } = require('./run');
const { summarize } = require('./statistics');

test('evaluation CLI rejects invalid sample counts and paths outside its workspace', () => {
  for (const samples of ['0', '-1', '1.5', '101', 'not-a-number']) assert.throws(() => options(['--samples', samples]));
  assert.throws(() => options(['--out', '../outside']));
  assert.equal(options([]).samples, 10);
});
test('one-replica integration enforces all expected outcomes and exposes cross-component gaps', { timeout: 120000 }, async () => {
  const result = await evaluate({ samples: 1 });
  assert.equal(result.transactions.length, 16); assert.equal(result.rules.length, 33);
  assert.ok(result.rules.every(row => row.passed));
  assert.ok(result.transactions.every(row => BigInt(row.gasUsed) > 0n && row.broadcastToReceiptMs >= 0));
  assert.equal(new Set(result.transactions.map(row => row.transactionHash)).size, 16);
  assert.deepEqual(result.summary, summarize(result.transactions, result.rules));
  assert.equal(result.summary.rules.allowed.n, 16); assert.equal(result.summary.rules.denied.n, 17);
  const gap = result.integrations.find(row => row.name === 'cross_component_contracts');
  assert.equal(gap.recallExpiryPropagationGap, true);
  assert.equal(gap.observations.length, 2);
  assert.ok(gap.observations.every(row => row.traceabilityInvalid && row.dispensingSucceeded));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('phase6-synthetic-operator-token'));
  assert.ok(!serialized.includes('phase6-synthetic-provider-token'));
});
