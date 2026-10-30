import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import ReactDOMServer from 'react-dom/server';
import { fetchAuthorizedPharmacies, fetchOverviewEntry, DEMO_BEARER_TOKEN } from './api.js';
import {
  escalationQueue, loadOverview, overviewSummary, shouldShowOverview, sortRows, tierDistribution, toOverviewRow,
} from './overview.js';
import { HealthAuthorityView } from './HealthAuthorityView.js';
import { ProvenanceChip, resolveProvenance } from './provenance.js';

// API payload shapes as returned by the Component 3 backend; all values are simulated.
const breakdown = count => Object.fromEntries(['delivery', 'recall', 'complaint', 'inspection']
  .map(name => [name, { status: 'ASSESSABLE', value: 80, weight: 0.25, evidenceCount: count, source: 'SYNTHETIC' }]));
const assessment = (pharmacyId, score, tier, critical = false, extra = {}) => ({
  pharmacyId,
  demoLabel: 'LOCAL_SYNTHETIC_DEMO',
  blockchainVerification: 'NOT_PERFORMED',
  status: score === null ? 'NOT_ASSESSABLE' : 'ASSESSABLE',
  score,
  tier,
  breakdown: breakdown(2),
  missingIndicators: score === null ? [{ name: 'recall' }] : [],
  criticalEscalationRequired: critical,
  evidenceSource: 'SYNTHETIC',
  limitations: [],
  ...extra,
});
const entry = (data, criticalFindings = null) => ({ pharmacyCode: data.pharmacyId, available: true, assessment: data, criticalFindings });

const ENTRIES = [
  entry(assessment('PH-HT', 95.3, 'HIGHLY_TRUSTED')),
  entry(assessment('PH-CRIT', 98.5, 'HIGHLY_TRUSTED', true), { required: true, findings: [{ id: 'F1' }] }),
  entry(assessment('PH-TR', 72.333, 'TRUSTED')),
  entry(assessment('PH-UR', 51.5, 'UNDER_REVIEW')),
  entry(assessment('PH-EA', 24, 'ESCALATION_ALERT')),
  entry(assessment('PH-NA', null, 'NOT_ASSESSABLE')),
  { pharmacyCode: 'PH-DOWN', available: false, error: 'The Component 3 service returned an error (HTTP 503).' },
];
const ROWS = ENTRIES.map(toOverviewRow);
const render = props => ReactDOMServer.renderToStaticMarkup(createElement(HealthAuthorityView, props));
const rowHtml = (html, code) => html.match(new RegExp(`<tr[^>]*data-row="${code}"[\\s\\S]*?</tr>`))?.[0] || '';

test('renders assessable rows with score and tier, and NOT_ASSESSABLE rows with neither', () => {
  const html = render({ rows: ROWS });
  const assessable = rowHtml(html, 'PH-TR');
  assert.match(assessable, /data-cell="score">72\.3</);
  assert.match(assessable, /data-cell="tier">Trusted</);
  const notAssessable = rowHtml(html, 'PH-NA');
  assert.match(notAssessable, /data-status="NOT_ASSESSABLE"/);
  assert.match(notAssessable, /data-cell="score">Not assessable</);
  assert.match(notAssessable, /data-cell="tier"><\/td>/);
  assert.doesNotMatch(notAssessable, />0(\.0)?</);
  assert.match(html, /Decision support, not a regulatory determination\./);
});

test('a NOT_ASSESSABLE row never carries a score or tier, even if the payload is inconsistent', () => {
  const row = toOverviewRow(entry(assessment('PH-BAD', null, 'NOT_ASSESSABLE', false, { score: 55, status: 'NOT_ASSESSABLE' })));
  assert.equal(row.status, 'NOT_ASSESSABLE');
  assert.equal(row.score, null);
  assert.equal(row.tier, null);
});

test('a failed pharmacy fetch renders an unavailable row instead of failing the overview', async () => {
  const pharmacies = [
    { pharmacyCode: 'PH-OK', accessTypes: ['REGULATORY'], permissions: ['ASSESSMENT_READ'] },
    { pharmacyCode: 'PH-DOWN', accessTypes: ['REGULATORY'], permissions: ['ASSESSMENT_READ'] },
  ];
  const entries = await loadOverview({
    pharmacies,
    mode: 'live',
    accessToken: 'token',
    fetchEntry: async ({ pharmacyCode }) => {
      if (pharmacyCode === 'PH-DOWN') throw Object.assign(new Error('Service unavailable.'), { status: 503 });
      return { assessment: assessment('PH-OK', 81, 'HIGHLY_TRUSTED'), criticalFindings: null };
    },
  });
  assert.deepEqual(entries.map(item => item.available), [true, false]);
  const html = render({ rows: entries.map(toOverviewRow) });
  const down = rowHtml(html, 'PH-DOWN');
  assert.match(down, /data-status="UNAVAILABLE"/);
  assert.match(down, /data-cell="score">Unavailable</);
  assert.match(down, /title="Service unavailable\."/);
  assert.match(rowHtml(html, 'PH-OK'), /data-cell="score">81\.0</);
});

test('critical findings are fetched only when the grant permits them', async () => {
  const requested = [];
  await loadOverview({
    pharmacies: [
      { pharmacyCode: 'PH-A', accessTypes: ['REGULATORY'], permissions: ['ASSESSMENT_READ', 'CRITICAL_FINDINGS_READ'] },
      { pharmacyCode: 'PH-B', accessTypes: ['REGULATORY'], permissions: ['ASSESSMENT_READ'] },
      { pharmacyCode: 'PH-C', accessTypes: ['REGULATORY'], permissions: ['EVIDENCE_READ'] },
    ],
    mode: 'live',
    accessToken: 'token',
    fetchEntry: async options => { requested.push([options.pharmacyCode, options.includeCriticalFindings]); return { assessment: assessment(options.pharmacyCode, 70, 'TRUSTED') }; },
  });
  assert.deepEqual(requested, [['PH-A', true], ['PH-B', false]]);
});

test('sorts by score and tier with missing values always last, never treated as 0', () => {
  const byScoreDesc = sortRows(ROWS, { key: 'score', direction: 'desc' }).map(row => row.pharmacyCode);
  assert.deepEqual(byScoreDesc, ['PH-CRIT', 'PH-HT', 'PH-TR', 'PH-UR', 'PH-EA', 'PH-DOWN', 'PH-NA']);
  const byScoreAsc = sortRows(ROWS, { key: 'score', direction: 'asc' }).map(row => row.pharmacyCode);
  assert.deepEqual(byScoreAsc, ['PH-EA', 'PH-UR', 'PH-TR', 'PH-HT', 'PH-CRIT', 'PH-DOWN', 'PH-NA']);
  const byTier = sortRows(ROWS, { key: 'tier', direction: 'desc' }).map(row => row.tier);
  assert.deepEqual(byTier, ['HIGHLY_TRUSTED', 'HIGHLY_TRUSTED', 'TRUSTED', 'UNDER_REVIEW', 'ESCALATION_ALERT', null, null]);
  const html = render({ rows: ROWS, sort: { key: 'tier', direction: 'asc' } });
  assert.ok(html.indexOf('data-row="PH-EA"') < html.indexOf('data-row="PH-HT"'));
  assert.match(html, /aria-sort="ascending"[^>]*><button[^>]*data-sort="tier"/);
});

test('counts every tier plus NOT_ASSESSABLE and unavailable', () => {
  assert.deepEqual(tierDistribution(ROWS), {
    HIGHLY_TRUSTED: 2, TRUSTED: 1, UNDER_REVIEW: 1, ESCALATION_ALERT: 1, NOT_ASSESSABLE: 1, UNAVAILABLE: 1,
  });
  const html = render({ rows: ROWS });
  assert.match(html, /aria-label="Highly trusted: 2 of 7"/);
  assert.match(html, /aria-label="Not assessable: 1 of 7"/);
  assert.match(html, /aria-label="Unavailable: 1 of 7"/);
  assert.deepEqual(overviewSummary(ROWS), { total: 7, assessable: 5, notAssessable: 1, unavailable: 1, escalations: 2 });
});

test('escalation queue holds critical-with-high-score and ESCALATION_ALERT pharmacies only', () => {
  const queue = escalationQueue(ROWS);
  assert.deepEqual(queue.map(row => row.pharmacyCode), ['PH-CRIT', 'PH-EA']);
  assert.deepEqual(queue[0].escalationReasons, ['Critical finding']);
  assert.equal(queue[0].score, 98.5);
  assert.deepEqual(queue[1].escalationReasons, ['Escalation-alert tier']);
  const html = render({ rows: ROWS });
  assert.match(html, /data-queue="PH-CRIT"/);
  assert.match(html, /data-queue="PH-EA"/);
  assert.doesNotMatch(html, /data-queue="PH-HT"/);
  assert.doesNotMatch(html, /data-queue="PH-NA"/);
});

test('a critical-findings flag counts even when the assessment flag is absent', () => {
  const withoutFlag = code => {
    const data = assessment(code, 90, 'HIGHLY_TRUSTED');
    delete data.criticalEscalationRequired;
    return data;
  };
  const row = toOverviewRow(entry(withoutFlag('PH-X'), { required: true }));
  assert.equal(row.criticalEscalationRequired, true);
  assert.deepEqual(row.escalationReasons, ['Critical finding']);
  // No flag anywhere and critical findings denied: unknown, never assumed to be "no escalation".
  const denied = toOverviewRow(entry(withoutFlag('PH-Y'), { accessDenied: true }));
  assert.equal(denied.criticalEscalationRequired, null);
});

test('overview is shown in sample mode and for regulatory access, not for pharmacy-only users', () => {
  assert.equal(shouldShowOverview('demo', []), true);
  assert.equal(shouldShowOverview('live', [{ pharmacyCode: 'P', accessTypes: ['REGULATORY'], permissions: ['ASSESSMENT_READ'] }]), true);
  assert.equal(shouldShowOverview('live', [{ pharmacyCode: 'P', accessTypes: ['PHARMACY'], permissions: ['ASSESSMENT_READ'] }]), false);
  assert.equal(shouldShowOverview('login', []), false);
});

test('the provenance chip is still present when only overview data is on screen', () => {
  const chip = resolveProvenance({ mode: 'live', bundle: null, overview: ENTRIES });
  const html = ReactDOMServer.renderToStaticMarkup(createElement(ProvenanceChip, { provenance: chip }));
  assert.match(html, /Simulated sample dataset/);
  const mixed = resolveProvenance({
    mode: 'live',
    bundle: null,
    overview: [entry({ ...assessment('PH-R', 70, 'TRUSTED'), demoLabel: null, evidenceSource: 'REAL' }),
      entry({ ...assessment('PH-S', 70, 'TRUSTED'), demoLabel: null })],
  });
  assert.equal(mixed.kind, 'mixed');
  assert.equal(resolveProvenance({ mode: 'live', bundle: null, overview: [{ pharmacyCode: 'X', available: false }] }), null);
});

test('overview fetch uses only the existing read-only endpoints', async () => {
  const calls = [];
  const fetchImpl = async (path, options) => {
    calls.push({ path, method: options.method, auth: options.headers.Authorization });
    const data = path.includes('critical-findings') ? { required: false, findings: [] } : assessment('PH-1', 70, 'TRUSTED');
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) };
  };
  const result = await fetchOverviewEntry({ pharmacyCode: 'PH-1', mode: 'demo', includeCriticalFindings: true, fetchImpl });
  assert.equal(result.assessment.pharmacyId, 'PH-1');
  assert.deepEqual(calls.map(call => [call.path, call.method]), [
    ['/c3-demo-api/api/v1/pharmacies/PH-1/trust-assessment', 'GET'],
    ['/c3-demo-api/api/v1/pharmacies/PH-1/trust-assessment/critical-findings', 'GET'],
  ]);
  assert.ok(calls.every(call => call.auth === `Bearer ${DEMO_BEARER_TOKEN}`));
  await assert.rejects(fetchOverviewEntry({ pharmacyCode: 'PH-1', mode: 'live', fetchImpl }), /access token/);
});

test('sample mode reads the session pharmacy list from the demo API', async () => {
  let requested;
  const access = await fetchAuthorizedPharmacies({
    mode: 'demo',
    fetchImpl: async (path, options) => {
      requested = [path, options.headers.Authorization];
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {
        pharmacies: [{ pharmacyCode: 'C3-DEMO-PHARMACY-001', accessTypes: ['REGULATORY'], permissions: ['ASSESSMENT_READ'] }],
        requiresWalletVerification: false,
      } }) };
    },
  });
  assert.deepEqual(requested, ['/c3-demo-api/api/v1/session/pharmacies', `Bearer ${DEMO_BEARER_TOKEN}`]);
  assert.equal(access.pharmacies.length, 1);
  await assert.rejects(fetchAuthorizedPharmacies({ fetchImpl: async () => ({}) }), /access token/);
});
