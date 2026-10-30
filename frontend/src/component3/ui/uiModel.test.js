import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSection, distributorHeroStats, navItemsFor, navLabel, parseFraction, pharmacyHeroStats, regulatorHeroStats,
  roleBadge, sampleHeroStats, sectionAllowed, statusIndicator, stepState, tierTone,
} from './uiModel.js';
import { regulatorRow } from '../live/liveModel.js';

const session = (role, allowedActions, extra = {}) => ({ status: 'ACTIVE', role, allowedActions, ...extra });
const REGULATOR = session('REGULATOR', ['workspace.regulator', 'overview.read', 'calculation.read', 'recall.issue', 'complaint.log',
  'complaint.screen', 'inspection.record', 'inspection.finalize', 'snapshot.finalize', 'auditLog.read']);
const PHARMACY = session('PHARMACY_USER', ['workspace.pharmacy', 'calculation.read', 'delivery.confirm'], { pharmacy: { code: 'C3-PH-A' } });
const DISTRIBUTOR = session('DISTRIBUTOR', ['workspace.distributor', 'delivery.create', 'delivery.markArrived'], { distributor: { code: 'C3-DS-1' } });
const ids = groups => groups.flatMap(group => group.items.map(item => item.id));
const labels = groups => groups.flatMap(group => group.items.map(item => item.label));
const SCORE_WORDS = /score|assessment|calculation|trust|tier|history/i;

test('regulator nav lists every section in OVERVIEW / PROCESSES / REVIEW order', () => {
  const groups = navItemsFor({ mode: 'workspace', session: REGULATOR });
  assert.deepEqual(groups.map(group => group.group), ['Overview', 'Processes', 'Review']);
  assert.deepEqual(ids(groups), ['overview', 'pharmacies', 'recalls', 'complaints', 'inspections', 'assessments', 'audit']);
  assert.equal(defaultSection(REGULATOR), 'overview');
});

test('nav is filtered by allowedActions only', () => {
  const limited = session('REGULATOR', ['workspace.regulator', 'overview.read', 'auditLog.read']);
  assert.deepEqual(ids(navItemsFor({ mode: 'workspace', session: limited })), ['overview', 'audit']);
  assert.equal(sectionAllowed(limited, 'recalls'), false);
  assert.equal(sectionAllowed(limited, 'audit'), true);
  assert.equal(sectionAllowed(limited, 'unknown'), false);
});

test('distributor nav never includes a score, tier, assessment or calculation item', () => {
  const groups = navItemsFor({ mode: 'workspace', session: DISTRIBUTOR });
  assert.deepEqual(ids(groups), ['newDelivery', 'deliveries']);
  assert.ok(labels(groups).every(text => !SCORE_WORDS.test(text)));
  // Even if a session were wrongly granted calculation.read, the distributor nav has no score link.
  const overGranted = session('DISTRIBUTOR', [...DISTRIBUTOR.allowedActions, 'calculation.read', 'snapshot.finalize', 'overview.read']);
  const overIds = ids(navItemsFor({ mode: 'workspace', session: overGranted }));
  assert.deepEqual(overIds, ['newDelivery', 'deliveries']);
  assert.ok(!overIds.some(id => ['score', 'history', 'pharmacies', 'assessments', 'overview'].includes(id)));
});

test('pharmacy nav shows own score, history and tasks', () => {
  const groups = navItemsFor({ mode: 'workspace', session: PHARMACY });
  assert.deepEqual(ids(groups), ['score', 'history', 'tasks']);
  assert.equal(navLabel(groups, 'score'), 'My trust score');
  assert.equal(navLabel(groups, 'missing'), '');
});

test('inactive or unknown sessions fail closed with no nav', () => {
  assert.deepEqual(navItemsFor({ mode: 'workspace', session: { ...REGULATOR, status: 'SUSPENDED' } }), []);
  assert.deepEqual(navItemsFor({ mode: 'workspace', session: session('ADMIN', ['overview.read']) }), []);
  assert.deepEqual(navItemsFor({ mode: 'workspace', session: null }), []);
  assert.deepEqual(navItemsFor({ mode: 'login' }), []);
  assert.equal(defaultSection(null), null);
});

test('sample mode nav is in-page anchors', () => {
  const groups = navItemsFor({ mode: 'demo' });
  assert.deepEqual(groups.flatMap(group => group.items.map(item => item.href)), ['#c3-sample-overview', '#c3-assessment-detail', '#c3-validation']);
});

test('status indicator always carries a text label', () => {
  assert.deepEqual(statusIndicator({ mode: 'workspace', liveSession: REGULATOR }), { tone: 'ok', label: 'API connected' });
  assert.deepEqual(statusIndicator({ mode: 'live', error: 'boom' }), { tone: 'error', label: 'Session check failed' });
  assert.deepEqual(statusIndicator({ mode: 'live' }), { tone: 'warn', label: 'Checking session…' });
  assert.equal(statusIndicator({ mode: 'demo' }).label, 'Sample API');
  assert.equal(statusIndicator({ mode: 'login' }).label, 'Not signed in');
});

test('role badge names the server-resolved role and scope', () => {
  assert.equal(roleBadge(PHARMACY), 'Pharmacy user · C3-PH-A');
  assert.equal(roleBadge(DISTRIBUTOR), 'Distributor · C3-DS-1');
  assert.equal(roleBadge(REGULATOR), 'Regulator');
  assert.equal(roleBadge({ ...REGULATOR, status: 'SUSPENDED' }), null);
});

test('tier tone maps labels; unknown labels stay neutral', () => {
  assert.equal(tierTone('Highly trusted'), 'ok');
  assert.equal(tierTone('Escalation alert'), 'danger');
  assert.equal(tierTone('Not assessable'), 'neutral');
  assert.equal(tierTone(undefined), 'neutral');
});

test('parseFraction never turns Not assessable or Unavailable into 0', () => {
  assert.deepEqual(parseFraction('7/10'), { numerator: 7, denominator: 10, ratio: 0.7 });
  assert.equal(parseFraction('0/4').ratio, 0);
  for (const text of ['Not assessable', 'Unavailable', 'No eligible records', '', null, '3/0', '5/4']) assert.equal(parseFraction(text), null);
});

test('regulator hero stats count rows from regulatorRow', () => {
  const rows = [
    regulatorRow({ pharmacyId: 'A', status: 'ASSESSABLE', score: 85, tier: 'HIGHLY_TRUSTED' }, null),
    regulatorRow({ pharmacyId: 'B', status: 'ASSESSABLE', score: 55, tier: 'UNDER_REVIEW', criticalEscalationRequired: true }, null),
    regulatorRow({ pharmacyId: 'C', status: 'NOT_ASSESSABLE', score: null, tier: null }, null),
  ];
  assert.deepEqual(regulatorHeroStats(rows).map(stat => stat.label), ['3 pharmacies', '1 under review', '1 critical escalation', '1 not assessable']);
  assert.deepEqual(regulatorHeroStats([]).map(stat => stat.label), ['0 pharmacies', '0 under review', '0 critical escalations', '0 not assessable']);
});

test('pharmacy hero stats show Not assessable (never 0) and count open tasks', () => {
  const tasks = { deliveriesToConfirm: [{}], recallActionsDue: [{}, {}], complaintsToResolve: [] };
  const notAssessable = pharmacyHeroStats({ status: 'NOT_ASSESSABLE', scoreText: 'Not assessable', tierText: 'Not assessable', criticalEscalationRequired: false }, tasks);
  assert.deepEqual(notAssessable.map(stat => stat.label), ['Not assessable', 'Tier: Not assessable', '3 open tasks']);
  assert.ok(notAssessable.every(stat => !/\b0(\.0)?\b/.test(stat.label)));
  const assessable = pharmacyHeroStats({ status: 'ASSESSABLE', scoreText: '72.5', tierText: 'Trusted', criticalEscalationRequired: true }, null);
  assert.deepEqual(assessable.map(stat => stat.label), ['Score 72.5', 'Tier: Trusted', 'Tasks loading', 'Critical escalation']);
});

test('distributor hero stats contain delivery counts only', () => {
  const stats = distributorHeroStats([{ status: 'DISPATCHED' }, { status: 'ARRIVED' }, { status: 'DISPATCHED' }]);
  assert.deepEqual(stats.map(stat => stat.label), ['3 deliveries', '2 awaiting arrival', '1 awaiting pharmacy confirmation']);
  assert.ok(stats.every(stat => !SCORE_WORDS.test(stat.label)));
});

test('sample hero stats come from overviewSummary', () => {
  assert.deepEqual(sampleHeroStats({ total: 4, assessable: 3, notAssessable: 1, escalations: 1 }).map(stat => stat.label),
    ['4 pharmacies', '3 assessable', '1 not assessable', '1 escalation']);
  assert.deepEqual(sampleHeroStats(null), []);
});

test('stepState marks done steps, the first open step as current, the rest as upcoming', () => {
  assert.deepEqual(stepState([true, false, false]), ['done', 'current', 'upcoming']);
  assert.deepEqual(stepState([false, false, false]), ['current', 'upcoming', 'upcoming']);
  assert.deepEqual(stepState([true, true, true]), ['done', 'done', 'done']);
  assert.deepEqual(stepState(null), []);
});
