import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRITICAL_ESCALATION_REFS, GUIDELINE_REFS, NOT_STATED_IN_GUIDELINES, PROPOSED_PARAMETERS_LABEL, chipText, refsFor,
} from './guidelineRefs.js';
import { INDICATORS } from './liveModel.js';

const all = () => [...Object.values(GUIDELINE_REFS).flat(), ...CRITICAL_ESCALATION_REFS];

test('every indicator key has at least one reference', () => {
  for (const meta of INDICATORS) assert.ok(refsFor(meta.key).length >= 1, meta.key);
  assert.deepEqual(Object.keys(GUIDELINE_REFS).sort(), INDICATORS.map(meta => meta.key).sort());
});

test('no entry omits code, title, page or section', () => {
  for (const entry of all()) {
    for (const field of ['code', 'title', 'page', 'section', 'note']) {
      assert.ok(typeof entry[field] === 'string' && entry[field].trim().length > 0, `${entry.code} ${field}`);
    }
    assert.match(entry.code, /^GL-0\d\d$/);
    assert.match(entry.page, /^p\./);
  }
});

test('the proposed-parameters label is present verbatim', () => {
  assert.equal(PROPOSED_PARAMETERS_LABEL, 'Section-level reference. Weights, time windows and tier thresholds are proposed research parameters, not NMRA values.');
});

test('the critical-escalation entry exists and cites GL-033', () => {
  assert.ok(refsFor('criticalEscalation').length >= 1);
  assert.ok(CRITICAL_ESCALATION_REFS.some(entry => entry.code === 'GL-033' && entry.section === 's4.3(iii)(b)' && entry.page === 'p.8'));
});

test('the 24-hour window and 30-day target are recorded as not stated in the guidelines', () => {
  assert.ok(NOT_STATED_IN_GUIDELINES.some(text => /24-hour/.test(text) && /not stated/.test(text)));
  assert.ok(NOT_STATED_IN_GUIDELINES.some(text => /30-day/.test(text) && /not stated/.test(text)));
});

test('chip text is compact and unknown keys have no references', () => {
  assert.equal(chipText(GUIDELINE_REFS.complaint[0]), 'GL-013 p.8-10 s9');
  assert.deepEqual(refsFor('unknown'), []);
});
