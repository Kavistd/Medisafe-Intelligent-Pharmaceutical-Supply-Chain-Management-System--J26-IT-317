const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { summarize } = require('./statistics');
const root = path.resolve(__dirname, '../..');
function fingerprintMatches(bytes, expected, historical = false) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  if (hash(bytes) === expected) return true;
  // Git stores LF text; some recorded Windows checkout fingerprints use CRLF.
  // Only historical blob reads permit this exact, explicit reconstruction.
  return historical && hash(Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, '\r\n'))) === expected;
}
function verifyResults({ sourceRevision } = {}) {
  if (sourceRevision) {
    assert.match(sourceRevision, /^[0-9a-f]{40}$/i, 'Use an explicit full Git commit ID.');
    const resolved = execFileSync('git', ['rev-parse', '--verify', `${sourceRevision}^{commit}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    assert.equal(resolved, sourceRevision.toLowerCase());
  }
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
  const bytes = sourceRevision
    ? execFileSync('git', ['show', `${sourceRevision}:${relative}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    : fs.readFileSync(file);
  assert.ok(fingerprintMatches(bytes, expected, Boolean(sourceRevision)), `Source fingerprint changed: ${relative}`);
}
const lines = fs.readFileSync(path.join(__dirname, 'results/latest/transactions.csv'), 'utf8').trim().split(/\r?\n/);
const columns = lines.shift().split(',');
assert.equal(lines.length, result.transactions.length);
for (let i = 0; i < lines.length; i++) assert.equal(lines[i], columns.map(key => result.transactions[i][key]).join(','));
return { transactions: result.transactions.length, checks: result.rules.length, sourceFiles: Object.keys(result.environment.sourceSha256).length,
  sourceRevision: sourceRevision || 'current working tree' };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  assert.ok(!args.length || (args.length === 2 && args[0] === '--source-revision'), 'Usage: node verify-results.js [--source-revision FULL_COMMIT_ID]');
  const result = verifyResults({ sourceRevision: args[1] });
  console.log(`Verified ${result.transactions} raw transactions, ${result.checks} rule checks, summary statistics, CSV rows and ${result.sourceFiles} source fingerprints against ${result.sourceRevision}.`);
  if (args.length) console.log('Historical source audit only; this does not certify the current checkout or identify the unique execution-time revision. Git LF/Windows CRLF checkout reconstruction is permitted.');
}
module.exports = { verifyResults, fingerprintMatches };
