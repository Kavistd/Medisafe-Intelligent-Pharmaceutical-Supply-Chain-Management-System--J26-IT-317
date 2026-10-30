const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { verifyResults, fingerprintMatches } = require('./verify-results');
const revision = '483709f1dd29f68e2d0750ec6c6be9a0feba456a';
test('historical audit validates raw outcomes, CSV and all recorded source fingerprints', () => {
  const files = ['results.json', 'transactions.csv', 'report.md'].map(file => require('node:path').join(__dirname, 'results/latest', file));
  const before = files.map(file => fs.readFileSync(file));
  const result = verifyResults({ sourceRevision: revision });
  assert.deepEqual(result, { transactions: 160, checks: 330, sourceFiles: 16, sourceRevision: revision });
  files.forEach((file, i) => assert.deepEqual(fs.readFileSync(file), before[i]));
});
test('historical line-ending handling cannot hide substantive source changes', () => {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const lf = Buffer.from('const value = 1;\n'), crlf = Buffer.from('const value = 1;\r\n');
  assert.equal(fingerprintMatches(lf, hash(crlf)), false);
  assert.equal(fingerprintMatches(lf, hash(crlf), true), true);
  assert.equal(fingerprintMatches(Buffer.from('const value = 2;\n'), hash(crlf), true), false);
});
test('audit refuses ambiguous or option-like revision arguments', () => {
  for (const sourceRevision of ['HEAD', '--help', '483709f']) assert.throws(() => verifyResults({ sourceRevision }), /full Git commit/);
});
