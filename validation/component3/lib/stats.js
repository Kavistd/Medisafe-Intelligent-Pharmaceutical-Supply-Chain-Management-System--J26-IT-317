'use strict';

// Values are rounded to this precision before ranking so that scores that are
// mathematically tied but differ by floating-point noise share an average rank.
const RANK_PRECISION = 1e9;

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values) {
  if (values.length === 0) return null;
  return values.reduce((best, value) => (value > best ? value : best), -Infinity);
}

function min(values) {
  if (values.length === 0) return null;
  return values.reduce((best, value) => (value < best ? value : best), Infinity);
}

/** 1-based ascending ranks; tied values receive the average of their ranks. */
function averageRanks(values) {
  const keyed = values
    .map((value, index) => [Math.round(value * RANK_PRECISION) / RANK_PRECISION, index])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const ranks = new Array(values.length);
  let start = 0;
  while (start < keyed.length) {
    let end = start;
    while (end + 1 < keyed.length && keyed[end + 1][0] === keyed[start][0]) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) ranks[keyed[k][1]] = rank;
    start = end + 1;
  }
  return ranks;
}

/** Pearson correlation; null when either series has zero variance. */
function pearson(x, y) {
  if (x.length !== y.length) throw new Error('Correlation series must have equal length.');
  if (x.length < 2) return null;
  const mx = mean(x);
  const my = mean(y);
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < x.length; i += 1) {
    covariance += (x[i] - mx) * (y[i] - my);
    varianceX += (x[i] - mx) ** 2;
    varianceY += (y[i] - my) ** 2;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** Spearman rank correlation = Pearson correlation of average ranks. */
function spearman(x, y) {
  return pearson(averageRanks(x), averageRanks(y));
}

/** Linear-interpolated quantile of an unsorted numeric array, p in [0, 1]. */
function quantile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

module.exports = { RANK_PRECISION, mean, max, min, averageRanks, pearson, spearman, quantile };
