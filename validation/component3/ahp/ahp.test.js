'use strict';

// Tests use a textbook matrix and constructed matrices only; no expert judgements.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RANDOM_INDEX, analyse, priorityVector, aggregateGeometricMean, loadExpertInputs, ahpStatus } = require('./ahp');

const close = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

// Classic 3x3 example (Saaty scale 1/3/5): published weights ~ 0.637, 0.258, 0.105;
// lambda_max ~ 3.039, CR ~ 0.033.
const TEXTBOOK = [
  [1, 3, 5],
  [1 / 3, 1, 3],
  [1 / 5, 1 / 3, 1],
];

function consistentFrom(weights) {
  return weights.map(wi => weights.map(wj => wi / wj));
}

test('random index table uses RI(4) = 0.90', () => {
  assert.equal(RANDOM_INDEX[3], 0.58);
  assert.equal(RANDOM_INDEX[4], 0.90);
});

test('textbook matrix reproduces published weights, lambda_max and CR', () => {
  const result = analyse(TEXTBOOK);
  close(result.weights[0], 0.637, 1e-3);
  close(result.weights[1], 0.258, 1e-3);
  close(result.weights[2], 0.105, 1e-3);
  close(result.weights.reduce((a, b) => a + b, 0), 1, 1e-12);
  close(result.lambdaMax, 3.039, 1e-3);
  close(result.cr, 0.033, 1e-3);
  assert.equal(result.consistent, true);
});

test('perfectly consistent 4x4 matrix recovers its weights with CR = 0', () => {
  const target = [0.4, 0.3, 0.2, 0.1];
  const result = analyse(consistentFrom(target));
  target.forEach((value, index) => close(result.weights[index], value, 1e-12));
  close(result.lambdaMax, 4, 1e-12);
  close(result.ci, 0, 1e-12);
  close(result.cr, 0, 1e-12);
});

test('an inconsistent matrix is flagged (CR >= 0.10)', () => {
  // Circular preferences: A > B, B > C, C > A.
  const result = analyse([
    [1, 5, 1 / 5],
    [1 / 5, 1, 5],
    [5, 1 / 5, 1],
  ]);
  assert.ok(result.cr >= 0.10);
  assert.equal(result.consistent, false);
});

test('rejects non-reciprocal, non-square and non-positive matrices', () => {
  assert.throws(() => priorityVector([[1, 2], [2, 1]]), /reciprocal/);
  assert.throws(() => priorityVector([[1, 2], [0.5]]), /square/);
  assert.throws(() => priorityVector([[1, -2], [-0.5, 1]]), /positive/);
  assert.throws(() => priorityVector([[2, 1], [1, 2]]), /Diagonal/);
});

test('geometric-mean aggregation is reciprocal and averages judgements', () => {
  const a = consistentFrom([0.4, 0.3, 0.2, 0.1]);
  const b = consistentFrom([0.1, 0.2, 0.3, 0.4]);
  const group = aggregateGeometricMean([a, b]);
  close(group[0][3], Math.sqrt(4 * 0.25), 1e-12);
  for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) close(group[i][j] * group[j][i], 1, 1e-12);
  assert.deepEqual(aggregateGeometricMean([a]), a.map(row => row.map(value => Math.exp(Math.log(value)))));
});

test('missing input directory reports tooling ready without inventing results', () => {
  const absent = path.join(__dirname, 'directory-that-does-not-exist');
  const status = ahpStatus(absent);
  assert.equal(status.status, 'AHP: tooling ready, expert responses not yet collected');
  assert.equal(status.expertCount, 0);
  assert.deepEqual(loadExpertInputs(absent), []);
});

test('input files are validated and aggregated when present', () => {
  // Temporary directory inside ahp/ (removed in finally); never ahp/inputs/.
  const directory = fs.mkdtempSync(path.join(__dirname, '.tmp-test-inputs-'));
  try {
    const criteria = ['delivery', 'recall', 'complaint', 'inspection'];
    // Constructed test matrices, not expert answers; written to a temporary directory only.
    fs.writeFileSync(path.join(directory, 'a.json'), JSON.stringify({ expertId: 'TEST-A', criteria, matrix: consistentFrom([0.4, 0.3, 0.2, 0.1]) }));
    fs.writeFileSync(path.join(directory, 'b.json'), JSON.stringify({ expertId: 'TEST-B', criteria, matrix: consistentFrom([0.4, 0.3, 0.2, 0.1]) }));
    const status = ahpStatus(directory);
    assert.equal(status.expertCount, 2);
    close(status.group.weights.delivery, 0.4, 1e-12);
    close(status.group.cr, 0, 1e-12);
    fs.writeFileSync(path.join(directory, 'c.json'), JSON.stringify({ expertId: 'TEST-C', criteria: ['recall'], matrix: [[1]] }));
    assert.throws(() => loadExpertInputs(directory), /criteria/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
