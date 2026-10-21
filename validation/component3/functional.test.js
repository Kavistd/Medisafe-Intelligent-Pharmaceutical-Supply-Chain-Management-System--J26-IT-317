'use strict';

// SYNTHETIC validation data only; not real pharmacy data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CASES, TOLERANCE } = require('./functional');

for (const testCase of CASES) {
  test(`${testCase.id} ${testCase.title}`, async () => {
    const checks = await testCase.run();
    assert.ok(checks.length > 0);
    for (const item of checks) {
      if (item.absDiff !== null) assert.ok(item.absDiff <= TOLERANCE, `${item.label}: |${item.observed} - ${item.expected}| > ${TOLERANCE}`);
      assert.ok(item.pass, `${item.label}: expected ${JSON.stringify(item.expected)}, observed ${JSON.stringify(item.observed)}`);
    }
  });
}
