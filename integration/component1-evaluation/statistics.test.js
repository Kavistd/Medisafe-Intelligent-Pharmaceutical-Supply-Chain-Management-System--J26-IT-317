const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describe, summarize, rawCid } = require('./statistics');
test('statistics use sorted median, nearest-rank p95 and sample standard deviation', () => {
  const result = describe([4, 1, 3, 2]);
  assert.equal(result.mean, 2.5); assert.equal(result.median, 2.5); assert.equal(result.p95, 4);
  assert.equal(result.sampleStdDev, Math.sqrt(5 / 3));
  assert.equal(describe([1, 4, 2]).median, 2); assert.equal(describe([8]).sampleStdDev, null);
  assert.deepEqual(describe(Array.from({ length: 100 }, (_, i) => i + 1)).p95, 95);
  for (const invalid of [[], [NaN], [-1], [Infinity]]) assert.throws(() => describe(invalid));
});
test('enforcement summaries count failures and never invent accuracy for an empty category', () => {
  const result = summarize([], [{ expected: 'allow', passed: true }, { expected: 'deny', passed: false }]);
  assert.equal(result.rules.all.accuracy, 0.5); assert.equal(result.rules.denied.accuracy, 0);
  assert.equal(summarize([], []).rules.all.accuracy, null);
});
test('fixture CIDs are deterministic and content-sensitive', () => {
  assert.equal(rawCid(Buffer.from('hello world')), 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e');
  assert.notEqual(rawCid(Buffer.from('hello')), rawCid(Buffer.from('world')));
});
