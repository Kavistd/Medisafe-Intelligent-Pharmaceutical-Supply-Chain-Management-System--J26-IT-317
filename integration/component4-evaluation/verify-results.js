const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const result = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/latest/results.json'), 'utf8'));

// Verify transaction and rule counts
assert.equal(result.transactions.length, 4 * result.samples);
assert.equal(result.rules.length, 17 * result.samples);
assert.ok(result.rules.every(row => row.passed), 'All rule conformance checks must pass');

// Verify unique transaction hashes
assert.equal(new Set(result.transactions.map(row => row.txHash)).size, result.transactions.length);

// Verify gas values
for (const row of result.transactions) {
  assert.ok(BigInt(row.gasUsed) > 0n);
  assert.ok(row.endToEndMs >= row.prepareMs);
}

// Verify transactions.csv matches
const csvLines = fs.readFileSync(path.join(__dirname, 'results/latest/transactions.csv'), 'utf8').trim().split(/\r?\n/);
const headers = csvLines.shift().split(',');
assert.equal(csvLines.length, result.transactions.length);

// Verify baseline_comparison.csv exists
assert.ok(fs.existsSync(path.join(__dirname, 'results/latest/baseline_comparison.csv')));
assert.ok(fs.existsSync(path.join(__dirname, 'results/latest/report.md')));

console.log(`Verified ${result.transactions.length} confirmed transactions, ${result.rules.length} rule checks, summary statistics, and generated report.`);
