const { createHash } = require('node:crypto');

function describe(values) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Expected nonempty finite nonnegative measurements.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted.at(-1),
    mean,
    median: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    sampleStdDev: sorted.length > 1 ? Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1)) : null
  };
}

function summarize(transactions, rules, baselineComparisons, cryptoMeasurements) {
  const operations = {};
  const methods = [...new Set(transactions.map(row => row.method))];
  for (const method of methods) {
    const rows = transactions.filter(row => row.method === method);
    operations[method] = Object.fromEntries(
      ['gasUsed', 'prepareMs', 'broadcastToReceiptMs', 'endToEndMs'].map(key => [
        key,
        describe(rows.map(row => Number(row[key])))
      ])
    );
  }

  const result = rows => ({
    n: rows.length,
    passed: rows.filter(row => row.passed).length,
    accuracy: rows.length ? rows.filter(row => row.passed).length / rows.length : null
  });

  const cryptoSummary = {};
  if (cryptoMeasurements && Object.keys(cryptoMeasurements).length > 0) {
    for (const [op, vals] of Object.entries(cryptoMeasurements)) {
      cryptoSummary[op] = describe(vals);
    }
  }

  const baselineSummary = {};
  if (baselineComparisons && Object.keys(baselineComparisons).length > 0) {
    for (const [op, vals] of Object.entries(baselineComparisons)) {
      baselineSummary[op] = {
        centralizedLatencyMs: describe(vals.map(v => v.centralizedLatencyMs)),
        blockchainLatencyMs: describe(vals.map(v => v.blockchainLatencyMs))
      };
    }
  }

  return {
    operations,
    crypto: cryptoSummary,
    baseline: baselineSummary,
    rules: {
      all: result(rules),
      allowed: result(rules.filter(row => row.expected === 'allow')),
      denied: result(rules.filter(row => row.expected === 'deny'))
    }
  };
}

module.exports = { describe, summarize };
