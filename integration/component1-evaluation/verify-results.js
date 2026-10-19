const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { summarize } = require('./statistics');
const root = path.resolve(__dirname, '../..');
const result = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/latest/results.json'), 'utf8'));
assert.equal(result.transactions.length, 16 * result.environment.replicas);
assert.equal(result.rules.length, 33 * result.environment.replicas);
assert.ok(result.rules.every(row => row.passed));
assert.equal(new Set(result.transactions.map(row => row.transactionHash)).size, result.transactions.length);
assert.deepEqual(result.summary, summarize(result.transactions, result.rules));
for (const row of result.transactions) {
  assert.ok(BigInt(row.gasUsed) > 0n);
  assert.ok(row.endToEndMs >= row.prepareMs && row.endToEndMs >= row.walletPipelineMs);
  assert.ok(row.walletPipelineMs >= row.broadcastToReceiptMs);
}
for (const [relative, expected] of Object.entries(result.environment.sourceSha256)) {
  const file = path.resolve(root, relative);
  assert.ok(file.startsWith(root + path.sep));
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected, `Source fingerprint changed: ${relative}`);
}
const lines = fs.readFileSync(path.join(__dirname, 'results/latest/transactions.csv'), 'utf8').trim().split(/\r?\n/);
const columns = lines.shift().split(',');
assert.equal(lines.length, result.transactions.length);
for (let i = 0; i < lines.length; i++) assert.equal(lines[i], columns.map(key => result.transactions[i][key]).join(','));
console.log(`Verified ${result.transactions.length} raw transactions, ${result.rules.length} rule checks, summary statistics, CSV rows and source fingerprints.`);
