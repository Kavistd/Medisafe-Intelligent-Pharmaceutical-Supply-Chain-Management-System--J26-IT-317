const { createHash } = require('node:crypto');

function describe(values) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Expected nonempty finite nonnegative measurements.');
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { n: sorted.length, min: sorted[0], max: sorted.at(-1), mean,
    median: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    sampleStdDev: sorted.length > 1 ? Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1)) : null };
}
function summarize(transactions, rules) {
  const operations = {};
  for (const method of [...new Set(transactions.map(row => row.method))]) {
    const rows = transactions.filter(row => row.method === method);
    operations[method] = Object.fromEntries(['gasUsed', 'prepareMs', 'walletPipelineMs', 'broadcastToReceiptMs', 'endToEndMs'].map(key => [key, describe(rows.map(row => Number(row[key])))]));
  }
  const result = rows => ({ n: rows.length, passed: rows.filter(row => row.passed).length,
    accuracy: rows.length ? rows.filter(row => row.passed).length / rows.length : null });
  return { operations, rules: { all: result(rules), allowed: result(rules.filter(row => row.expected === 'allow')), denied: result(rules.filter(row => row.expected === 'deny')) } };
}
// Fixture-only raw SHA-256 CIDv1, no UnixFS/provider compatibility claim.
function rawCid(bytes) {
  const input = Buffer.concat([Buffer.from([1, 0x55, 0x12, 0x20]), createHash('sha256').update(bytes).digest()]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'; let bits = 0, value = 0, text = 'b';
  for (const byte of input) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; text += alphabet[(value >>> bits) & 31]; }
    value &= (1 << bits) - 1;
  }
  if (bits) text += alphabet[(value << (5 - bits)) & 31];
  return text;
}
module.exports = { describe, summarize, rawCid };
