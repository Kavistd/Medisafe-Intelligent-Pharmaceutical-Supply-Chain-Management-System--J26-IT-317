import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import ReactDOMServer from 'react-dom/server';
import { ProvenanceChip, displayLabel, resolveProvenance } from './provenance.js';

const render = provenance => ReactDOMServer.renderToStaticMarkup(createElement(ProvenanceChip, { provenance }));
const chipFor = (mode, bundle) => render(resolveProvenance({ mode, bundle }));

// API payload shapes exactly as returned by the Component 3 backend; values are not altered.
const resources = ({ demoLabel = null, evidenceSource }) => ({
  assessment: { pharmacyId: 'PH-1', demoLabel, blockchainVerification: 'NOT_PERFORMED', status: 'ASSESSABLE', evidenceSource },
  evidence: { pharmacyId: 'PH-1', demoLabel, blockchainVerification: 'NOT_PERFORMED', evidenceSource },
  criticalFindings: { pharmacyId: 'PH-1', demoLabel, blockchainVerification: 'NOT_PERFORMED', required: false, findings: [] },
});

test('synthetic data always renders the simulated-sample chip', () => {
  const syntheticCases = [
    ['demo mode before any data loads', 'demo', null],
    ['demo mode with demo-labelled data', 'demo', resources({ demoLabel: 'LOCAL_SYNTHETIC_DEMO', evidenceSource: 'SYNTHETIC' })],
    ['live mode with SYNTHETIC evidence source', 'live', resources({ evidenceSource: 'SYNTHETIC' })],
    ['live mode with demo label only', 'live', resources({ demoLabel: 'LOCAL_SYNTHETIC_DEMO', evidenceSource: undefined })],
    ['demo label contradicting a REAL source label', 'live', resources({ demoLabel: 'LOCAL_SYNTHETIC_DEMO', evidenceSource: 'REAL' })],
    ['demo label on the critical-findings resource only', 'live', {
      assessment: { evidenceSource: 'REAL' }, evidence: { accessDenied: true }, criticalFindings: { demoLabel: 'LOCAL_SYNTHETIC_DEMO' },
    }],
    ['NOT_ASSESSABLE synthetic assessment', 'demo', { assessment: { status: 'NOT_ASSESSABLE', score: null, demoLabel: 'LOCAL_SYNTHETIC_DEMO', evidenceSource: 'SYNTHETIC' } }],
  ];
  for (const [label, mode, bundle] of syntheticCases) {
    const html = chipFor(mode, bundle);
    assert.match(html, /Simulated sample dataset/, label);
    assert.match(html, /data-provenance="simulated"/, label);
    assert.match(html, /title="[^"]*not real pharmacy data/, label);
  }
});

test('the chip is rendered exactly once per view', () => {
  const html = chipFor('demo', resources({ demoLabel: 'LOCAL_SYNTHETIC_DEMO', evidenceSource: 'SYNTHETIC' }));
  assert.equal(html.match(/data-provenance=/g).length, 1);
});

test('MIXED evidence renders its own wording', () => {
  for (const bundle of [
    resources({ evidenceSource: 'MIXED' }),
    { assessment: { evidenceSource: 'SYNTHETIC' }, evidence: { evidenceSource: 'REAL' } },
  ]) {
    const html = chipFor('live', bundle);
    assert.match(html, />Mixed evidence</);
    assert.match(html, /data-provenance="mixed"/);
    assert.doesNotMatch(html, /Simulated sample dataset/);
  }
});

test('REAL evidence renders declared-source wording and never claims verification', () => {
  const html = chipFor('live', resources({ evidenceSource: 'REAL' }));
  assert.match(html, /Declared source records \(unverified\)/);
  assert.match(html, /data-provenance="declared"/);
  assert.match(html, /not been independently verified/);
  assert.doesNotMatch(html, /Simulated sample/);
});

test('loaded data without a provenance label still shows a chip', () => {
  const html = chipFor('live', { assessment: { status: 'NOT_ASSESSABLE' } });
  assert.match(html, /Provenance unavailable/);
});

test('no chip only when no data is displayed outside the sample-data mode', () => {
  assert.equal(resolveProvenance({ mode: 'login', bundle: null }), null);
  assert.equal(resolveProvenance({ mode: 'live', bundle: null }), null);
  assert.equal(render(null), '');
});

test('display labels change wording only, never the API values', () => {
  const source = { finding: 'SYNTHETIC_TEST_DATA', chain: 'NOT_PERFORMED' };
  assert.equal(displayLabel(source.finding), 'Simulated sample');
  assert.equal(displayLabel(source.chain), 'Not performed');
  assert.equal(displayLabel('DECLARED_REAL_UNVERIFIED'), 'Declared source (unverified)');
  assert.equal(displayLabel('CUSTOM_SOURCE'), 'CUSTOM_SOURCE');
  assert.equal(displayLabel(undefined), 'Unavailable');
  assert.deepEqual(source, { finding: 'SYNTHETIC_TEST_DATA', chain: 'NOT_PERFORMED' });
});
