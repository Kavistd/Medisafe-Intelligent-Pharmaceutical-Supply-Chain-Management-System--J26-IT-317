'use strict';

/**
 * Analytic Hierarchy Process (AHP) tooling for deriving indicator weights from
 * REAL expert pairwise judgements. No expert judgements are stored or invented
 * here; inputs are read from ahp/inputs/*.json when experts have supplied them
 * (see EXPERT_INPUT_TEMPLATE.md).
 *
 *   priority weights : principal eigenvector by power iteration, normalised to sum 1
 *   lambda_max       : mean of (A w)_i / w_i
 *   CI               : (lambda_max - n) / (n - 1)
 *   CR               : CI / RI(n), Saaty random index; acceptable when CR < 0.10
 *   group judgement  : element-wise geometric mean of expert matrices (AIJ)
 */
const fs = require('node:fs');
const path = require('node:path');

const CRITERIA = Object.freeze(['delivery', 'recall', 'complaint', 'inspection']);
// Saaty random consistency index by matrix size.
const RANDOM_INDEX = Object.freeze({ 1: 0, 2: 0, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49 });
const CR_THRESHOLD = 0.10;
const RECIPROCAL_TOLERANCE = 1e-6;

function validateMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 1) throw new Error('Pairwise matrix must be a non-empty array.');
  const n = matrix.length;
  if (!RANDOM_INDEX[n] && RANDOM_INDEX[n] !== 0) throw new Error(`Matrix size ${n} has no random index.`);
  matrix.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== n) throw new Error('Pairwise matrix must be square.');
    row.forEach((value, j) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Entry [${i}][${j}] must be a positive finite number.`);
      }
    });
    if (Math.abs(row[i] - 1) > RECIPROCAL_TOLERANCE) throw new Error(`Diagonal entry [${i}][${i}] must be 1.`);
  });
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(matrix[i][j] * matrix[j][i] - 1) > RECIPROCAL_TOLERANCE) {
        throw new Error(`Entries [${i}][${j}] and [${j}][${i}] must be reciprocal.`);
      }
    }
  }
  return n;
}

function multiply(matrix, vector) {
  return matrix.map(row => row.reduce((sum, value, j) => sum + value * vector[j], 0));
}

function priorityVector(matrix, { maxIterations = 10000, tolerance = 1e-15 } = {}) {
  const n = validateMatrix(matrix);
  let weights = new Array(n).fill(1 / n);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const product = multiply(matrix, weights);
    const total = product.reduce((sum, value) => sum + value, 0);
    const next = product.map(value => value / total);
    const change = Math.max(...next.map((value, i) => Math.abs(value - weights[i])));
    weights = next;
    if (change <= tolerance) break;
  }
  return weights;
}

function analyse(matrix) {
  const n = validateMatrix(matrix);
  const weights = priorityVector(matrix);
  const product = multiply(matrix, weights);
  const lambdaMax = product.reduce((sum, value, i) => sum + value / weights[i], 0) / n;
  const ci = n > 2 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = RANDOM_INDEX[n];
  const cr = ri > 0 ? ci / ri : 0;
  return { n, weights, lambdaMax, ci, ri, cr, consistent: cr < CR_THRESHOLD };
}

/** Element-wise geometric mean of several experts' matrices (preserves reciprocity). */
function aggregateGeometricMean(matrices) {
  if (!Array.isArray(matrices) || matrices.length === 0) throw new Error('At least one expert matrix is required.');
  const n = validateMatrix(matrices[0]);
  matrices.forEach(matrix => {
    if (validateMatrix(matrix) !== n) throw new Error('All expert matrices must have the same size.');
  });
  return Array.from({ length: n }, (_unused, i) => Array.from({ length: n }, (_unused2, j) =>
    Math.exp(matrices.reduce((sum, matrix) => sum + Math.log(matrix[i][j]), 0) / matrices.length)));
}

/** Label weights with the Component 3 criteria order. */
function namedWeights(weights) {
  return Object.fromEntries(CRITERIA.map((name, index) => [name, weights[index]]));
}

/**
 * Read real expert input files from a directory. Returns [] when the directory is
 * absent or holds no .json files. Each file: { expertId, criteria, matrix }.
 */
function loadExpertInputs(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(name => name.toLowerCase().endsWith('.json'))
    .sort()
    .map(name => {
      const data = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      if (JSON.stringify(data.criteria) !== JSON.stringify(CRITERIA)) {
        throw new Error(`${name}: criteria must be exactly ${CRITERIA.join(', ')} in that order.`);
      }
      validateMatrix(data.matrix);
      if (data.matrix.length !== CRITERIA.length) throw new Error(`${name}: matrix must be 4 x 4.`);
      return { file: name, expertId: String(data.expertId || name), matrix: data.matrix };
    });
}

/** AHP status block for the results report. */
function ahpStatus(directory) {
  const inputs = loadExpertInputs(directory);
  if (inputs.length === 0) {
    return { status: 'AHP: tooling ready, expert responses not yet collected', expertCount: 0 };
  }
  const individual = inputs.map(input => {
    const result = analyse(input.matrix);
    return { expertId: input.expertId, weights: namedWeights(result.weights), cr: result.cr, consistent: result.consistent };
  });
  const group = analyse(aggregateGeometricMean(inputs.map(input => input.matrix)));
  return {
    status: `AHP: ${inputs.length} expert response file(s) found in ahp/inputs/`,
    expertCount: inputs.length,
    individual,
    group: { weights: namedWeights(group.weights), lambdaMax: group.lambdaMax, ci: group.ci, cr: group.cr, consistent: group.consistent },
  };
}

module.exports = {
  CRITERIA,
  RANDOM_INDEX,
  CR_THRESHOLD,
  validateMatrix,
  priorityVector,
  analyse,
  aggregateGeometricMean,
  namedWeights,
  loadExpertInputs,
  ahpStatus,
};
