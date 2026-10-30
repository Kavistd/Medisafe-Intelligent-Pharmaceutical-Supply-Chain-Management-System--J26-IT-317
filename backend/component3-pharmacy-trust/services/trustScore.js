'use strict';

// Proposed research-design parameters; these are not official NMRA weights.
const WEIGHTS = Object.freeze({
  delivery: 0.35,
  recall: 0.30,
  complaint: 0.20,
  inspection: 0.15,
});

const INDICATORS = Object.freeze(['delivery', 'recall', 'complaint', 'inspection']);
const STATUSES = new Set(['ASSESSABLE', 'NOT_ASSESSABLE']);
const SOURCES = new Set(['SYNTHETIC', 'REAL']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} contains unsupported property "${key}".`);
    }
  }
}

function validateIndicator(name, indicator) {
  if (!isPlainObject(indicator)) {
    throw new Error(`Indicator "${name}" must be a plain object.`);
  }
  assertOnlyKeys(indicator, ['status', 'value', 'evidenceCount', 'source'], `Indicator "${name}"`);

  for (const key of ['status', 'evidenceCount', 'source']) {
    if (!Object.prototype.hasOwnProperty.call(indicator, key)) {
      throw new Error(`Indicator "${name}" requires "${key}".`);
    }
  }

  if (!STATUSES.has(indicator.status)) {
    throw new Error(`Indicator "${name}" status must be ASSESSABLE or NOT_ASSESSABLE.`);
  }
  if (!SOURCES.has(indicator.source)) {
    throw new Error(`Indicator "${name}" source must be SYNTHETIC or REAL.`);
  }
  if (!Number.isInteger(indicator.evidenceCount) || indicator.evidenceCount < 0) {
    throw new Error(`Indicator "${name}" evidenceCount must be an integer greater than or equal to zero.`);
  }

  const hasValue = Object.prototype.hasOwnProperty.call(indicator, 'value');
  if (indicator.status === 'ASSESSABLE') {
    if (!hasValue) throw new Error(`Assessable indicator "${name}" requires a numeric value.`);
    if (typeof indicator.value !== 'number' || !Number.isFinite(indicator.value)) {
      throw new Error(`Indicator "${name}" value must be a finite number.`);
    }
    if (indicator.value < 0 || indicator.value > 100) {
      throw new Error(`Indicator "${name}" value must be between 0 and 100 inclusive.`);
    }
  } else if (hasValue) {
    throw new Error(`Not-assessable indicator "${name}" must not contain a value property.`);
  }

  return {
    status: indicator.status,
    value: indicator.status === 'ASSESSABLE' ? indicator.value : null,
    evidenceCount: indicator.evidenceCount,
    source: indicator.source,
  };
}

function cloneFindingValue(value, path, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') {
    throw new Error(`Critical finding detail "${path}" must contain JSON-compatible values.`);
  }
  if (ancestors.has(value)) throw new Error(`Critical finding detail "${path}" must not contain circular references.`);

  ancestors.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = value.map((item, index) => cloneFindingValue(item, `${path}[${index}]`, ancestors));
  } else {
    if (!isPlainObject(value)) {
      throw new Error(`Critical finding detail "${path}" must contain only plain objects and arrays.`);
    }
    copy = {};
    for (const key of Object.keys(value)) {
      copy[key] = cloneFindingValue(value[key], `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
  return copy;
}

function validateCriticalFindings(findings) {
  if (!Array.isArray(findings)) {
    throw new Error('criticalFindings must be an array.');
  }
  return findings.map((finding, index) => {
    if (!isPlainObject(finding)) {
      throw new Error(`Critical finding at index ${index} must be a plain object.`);
    }
    for (const field of ['id', 'description']) {
      if (!Object.prototype.hasOwnProperty.call(finding, field) ||
          typeof finding[field] !== 'string' || finding[field].trim().length === 0) {
        throw new Error(`Critical finding at index ${index} requires a non-empty string "${field}".`);
      }
    }
    return cloneFindingValue(finding, `criticalFindings[${index}]`);
  });
}

function calculateTrustScore(input) {
  if (!isPlainObject(input)) throw new Error('Input must be a plain object.');
  assertOnlyKeys(input, [...INDICATORS, 'criticalFindings'], 'Input');

  const indicators = {};
  for (const name of INDICATORS) {
    if (!Object.prototype.hasOwnProperty.call(input, name)) {
      throw new Error(`Input requires indicator "${name}".`);
    }
    indicators[name] = validateIndicator(name, input[name]);
  }

  const findingsInput = Object.prototype.hasOwnProperty.call(input, 'criticalFindings') &&
    input.criticalFindings !== undefined ? input.criticalFindings : [];
  const findings = validateCriticalFindings(findingsInput);
  const sources = INDICATORS.map(name => indicators[name].source);
  const evidenceSource = sources.every(source => source === 'SYNTHETIC')
    ? 'SYNTHETIC'
    : sources.every(source => source === 'REAL') ? 'REAL' : 'MIXED';

  const breakdown = {};
  const missingIndicators = [];
  let score = 0;
  for (const name of INDICATORS) {
    const indicator = indicators[name];
    const assessable = indicator.status === 'ASSESSABLE';
    const weightedContribution = assessable ? indicator.value * WEIGHTS[name] : null;
    breakdown[name] = {
      status: indicator.status,
      value: indicator.value,
      weight: WEIGHTS[name],
      weightedContribution,
      evidenceCount: indicator.evidenceCount,
      source: indicator.source,
    };
    if (assessable) score += weightedContribution;
    else {
      missingIndicators.push({
        name,
        reason: 'Indicator status is NOT_ASSESSABLE; its evidence is insufficient or unavailable.',
      });
    }
  }

  const assessable = missingIndicators.length === 0;
  return {
    status: assessable ? 'ASSESSABLE' : 'NOT_ASSESSABLE',
    score: assessable ? score : null,
    breakdown,
    missingIndicators,
    criticalEscalation: {
      required: findings.length > 0,
      findings,
    },
    evidenceSource,
  };
}

function classifyTier(score) {
  if (score === null) return 'NOT_ASSESSABLE';
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('Score must be null or a finite number between 0 and 100 inclusive.');
  }
  if (score >= 80) return 'HIGHLY_TRUSTED';
  if (score >= 60) return 'TRUSTED';
  if (score >= 40) return 'UNDER_REVIEW';
  return 'ESCALATION_ALERT';
}

module.exports = { WEIGHTS, calculateTrustScore, classifyTier };
