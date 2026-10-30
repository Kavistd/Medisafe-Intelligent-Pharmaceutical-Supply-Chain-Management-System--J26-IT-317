/**
 * Pure view-model helpers for the Component 3 app shell (layout only).
 * Navigation is derived from the server-resolved session (role + allowedActions);
 * it only filters which links render and never grants anything. The API enforces access.
 */
import { canDo, workspaceForSession } from '../live/liveModel.js';

/** Section id -> action that must be allowed for the section to appear. */
export const SECTION_ACTIONS = Object.freeze({
  overview: 'overview.read',
  pharmacies: 'calculation.read',
  recalls: 'recall.issue',
  complaints: 'complaint.log',
  inspections: 'inspection.record',
  assessments: 'snapshot.finalize',
  audit: 'auditLog.read',
  score: 'calculation.read',
  tasks: 'workspace.pharmacy',
  history: 'calculation.read',
  newDelivery: 'delivery.create',
  deliveries: 'workspace.distributor',
});

const WORKSPACE_NAV = Object.freeze({
  regulator: [
    { group: 'Overview', items: [['overview', 'Overview', 'grid'], ['pharmacies', 'Pharmacies', 'building']] },
    { group: 'Processes', items: [['recalls', 'Recalls', 'alert'], ['complaints', 'Complaints', 'message'], ['inspections', 'Inspections', 'clipboard']] },
    { group: 'Review', items: [['assessments', 'Assessments', 'shield'], ['audit', 'Audit log', 'list']] },
  ],
  pharmacy: [
    { group: 'My pharmacy', items: [['score', 'My trust score', 'gauge'], ['history', 'History & calculation', 'history']] },
    { group: 'Work', items: [['tasks', 'My tasks', 'inbox']] },
  ],
  distributor: [
    { group: 'Deliveries', items: [['newDelivery', 'New delivery', 'truck'], ['deliveries', 'My deliveries', 'package']] },
  ],
});

const SAMPLE_NAV = Object.freeze([
  { group: 'Sample data', items: [['sample-overview', 'Sample overview', 'grid', '#c3-sample-overview'], ['sample-detail', 'Assessment detail', 'gauge', '#c3-assessment-detail'], ['sample-validation', 'Validation summary', 'check', '#c3-validation']] },
]);

const toGroups = (definition, keep = () => true) => definition
  .map(({ group, items }) => ({
    group,
    items: items.filter(([id]) => keep(id)).map(([id, label, icon, href]) => ({ id, label, icon, ...(href ? { href } : {}) })),
  }))
  .filter(group => group.items.length > 0);

/** Sidebar groups for the current mode; live workspaces are filtered by the session's allowedActions. */
export function navItemsFor({ mode, session } = {}) {
  if (mode === 'workspace') {
    const workspace = workspaceForSession(session);
    if (!workspace) return [];
    return toGroups(WORKSPACE_NAV[workspace], id => canDo(session, SECTION_ACTIONS[id]));
  }
  if (mode === 'demo') return toGroups(SAMPLE_NAV);
  return [];
}

/** First visible section for a session (or null when nothing is allowed). */
export function defaultSection(session) {
  const groups = navItemsFor({ mode: 'workspace', session });
  return groups[0]?.items[0]?.id || null;
}

export function sectionAllowed(session, sectionId) {
  return Boolean(SECTION_ACTIONS[sectionId]) && canDo(session, SECTION_ACTIONS[sectionId]);
}

export function navLabel(groups, id) {
  for (const group of groups) {
    const item = group.items.find(entry => entry.id === id);
    if (item) return item.label;
  }
  return '';
}

/** Top-bar connection indicator: always a text label plus a tone (never colour alone). */
export function statusIndicator({ mode, liveSession, error } = {}) {
  if (mode === 'workspace' && liveSession) return { tone: 'ok', label: 'API connected' };
  if (mode === 'live') return error ? { tone: 'error', label: 'Session check failed' } : { tone: 'warn', label: 'Checking session…' };
  if (mode === 'demo') return { tone: 'ok', label: 'Sample API' };
  return { tone: 'idle', label: 'Not signed in' };
}

const ROLE_LABELS = Object.freeze({ REGULATOR: 'Regulator', PHARMACY_USER: 'Pharmacy user', DISTRIBUTOR: 'Distributor' });

export function roleBadge(session) {
  if (!session || session.status !== 'ACTIVE' || !ROLE_LABELS[session.role]) return null;
  const scope = session.pharmacy?.code || session.distributor?.code || '';
  return scope ? `${ROLE_LABELS[session.role]} · ${scope}` : ROLE_LABELS[session.role];
}

/** Tone for a tier label (the label text itself is always rendered). */
export function tierTone(label) {
  switch (String(label || '').toLowerCase()) {
    case 'highly trusted': return 'ok';
    case 'trusted': return 'info';
    case 'under review': return 'warn';
    case 'escalation alert': return 'danger';
    default: return 'neutral';
  }
}

/** "7/10" -> { numerator: 7, denominator: 10, ratio: 0.7 }; anything else -> null (never 0). */
export function parseFraction(text) {
  const match = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(String(text || '').trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!(denominator > 0) || numerator > denominator) return null;
  return { numerator, denominator, ratio: numerator / denominator };
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Hero chips for the regulator overview, from rows already built by liveModel.regulatorRow. */
export function regulatorHeroStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const count = predicate => list.filter(predicate).length;
  return [
    { label: plural(list.length, 'pharmacy', 'pharmacies'), tone: 'neutral' },
    { label: `${count(row => row.tierText === 'Under review')} under review`, tone: 'warn' },
    { label: plural(count(row => row.criticalEscalationRequired), 'critical escalation', 'critical escalations'), tone: 'danger' },
    { label: `${count(row => row.tierText === 'Not assessable')} not assessable`, tone: 'neutral' },
  ];
}

/** Hero chips for the pharmacy workspace (calculationView + tasks payload). */
export function pharmacyHeroStats(view, tasks) {
  const open = tasks ? tasks.deliveriesToConfirm.length + tasks.recallActionsDue.length + tasks.complaintsToResolve.length : null;
  return [
    { label: view ? (view.status === 'ASSESSABLE' ? `Score ${view.scoreText}` : 'Not assessable') : 'Score loading', tone: 'info' },
    { label: view ? `Tier: ${view.tierText}` : 'Tier loading', tone: tierTone(view?.tierText) },
    { label: open === null ? 'Tasks loading' : plural(open, 'open task', 'open tasks'), tone: open ? 'warn' : 'neutral' },
    ...(view?.criticalEscalationRequired ? [{ label: 'Critical escalation', tone: 'danger' }] : []),
  ];
}

/** Hero chips for the distributor workspace: delivery counts only, never scores. */
export function distributorHeroStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return [
    { label: plural(list.length, 'delivery', 'deliveries'), tone: 'neutral' },
    { label: `${list.filter(row => row.status === 'DISPATCHED').length} awaiting arrival`, tone: 'warn' },
    { label: `${list.filter(row => row.status === 'ARRIVED').length} awaiting pharmacy confirmation`, tone: 'info' },
  ];
}

/** Hero chips for sample mode, from overview.overviewSummary(). */
export function sampleHeroStats(summary) {
  if (!summary) return [];
  return [
    { label: plural(summary.total, 'pharmacy', 'pharmacies'), tone: 'neutral' },
    { label: `${summary.assessable} assessable`, tone: 'ok' },
    { label: `${summary.notAssessable} not assessable`, tone: 'neutral' },
    { label: plural(summary.escalations, 'escalation', 'escalations'), tone: 'danger' },
  ];
}

/** Stepper state from per-step completion: done steps, the first open step is current, the rest are upcoming. */
export function stepState(doneFlags) {
  const flags = Array.isArray(doneFlags) ? doneFlags : [];
  const current = flags.findIndex(done => !done);
  return flags.map((done, index) => (done ? 'done' : index === current ? 'current' : 'upcoming'));
}
