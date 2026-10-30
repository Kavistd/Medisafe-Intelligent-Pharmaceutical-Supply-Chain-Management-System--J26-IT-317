import { createElement as h, Fragment } from 'react';
import { TIERS, TIER_LABELS, escalationQueue, overviewSummary, sortRows, tierDistribution } from './overview.js';

// Written with createElement (no JSX) so node:test can render it with react-dom/server.

const fmt = (value, digits = 3) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a');
const pct = value => (typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a');

function scoreText(row) {
  if (!row.available) return 'Unavailable';
  return row.score === null ? 'Not assessable' : row.score.toFixed(1);
}

function statusText(row) {
  return TIER_LABELS[row.status] || (row.status === 'ASSESSABLE' ? 'Assessable' : row.status);
}

function criticalText(row) {
  if (row.criticalEscalationRequired === true) return 'Required';
  if (row.criticalEscalationRequired === false) return 'No';
  return row.available ? 'Not permitted' : '—';
}

function SortHeader({ label, sortKey, sort, onSortChange }) {
  const active = sort.key === sortKey;
  const next = active && sort.direction === 'desc' ? 'asc' : 'desc';
  return h('th', { scope: 'col', 'aria-sort': active ? (sort.direction === 'desc' ? 'descending' : 'ascending') : 'none' },
    h('button', {
      type: 'button',
      className: 'c3-sort',
      'data-sort': sortKey,
      onClick: () => onSortChange?.({ key: sortKey, direction: next }),
    }, label, active ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''));
}

function SummaryHeader({ summary }) {
  const tile = (label, value, note) => h('div', { className: 'c3-ha-tile' },
    h('span', null, label), h('strong', null, value), note ? h('small', null, note) : null);
  return h('div', { className: 'c3-ha-tiles' },
    tile('Pharmacies', summary.total, summary.unavailable ? `${summary.unavailable} unavailable` : null),
    tile('Assessable', summary.assessable, `${summary.notAssessable} not assessable`),
    tile('Escalations', summary.escalations, 'critical finding or escalation-alert tier'));
}

function TierDistribution({ counts, total }) {
  const keys = [...TIERS, 'NOT_ASSESSABLE', ...(counts.UNAVAILABLE ? ['UNAVAILABLE'] : [])];
  return h('section', { className: 'c3-card c3-ha-panel', 'aria-labelledby': 'c3-tier-distribution' },
    h('h3', { id: 'c3-tier-distribution' }, 'Tier distribution'),
    h('ul', { className: 'c3-tier-bars' }, keys.map(key => h('li', {
      key,
      'data-tier': key,
      'aria-label': `${TIER_LABELS[key]}: ${counts[key]} of ${total}`,
    },
    h('span', { className: 'c3-tier-label' }, TIER_LABELS[key]),
    h('span', { className: 'c3-tier-track', 'aria-hidden': 'true' },
      h('span', { className: `c3-tier-fill c3-tier-${key.toLowerCase()}`, style: { width: `${total ? (counts[key] / total) * 100 : 0}%` } })),
    h('span', { className: 'c3-tier-count' }, counts[key])))));
}

function EscalationQueue({ queue, onSelect }) {
  return h('section', { className: 'c3-card c3-ha-panel', 'aria-labelledby': 'c3-escalation-queue' },
    h('h3', { id: 'c3-escalation-queue' }, 'Escalation queue'),
    queue.length === 0
      ? h('p', { className: 'c3-muted' }, 'No pharmacy currently has a critical escalation or an escalation-alert tier.')
      : h('ul', { className: 'c3-queue' }, queue.map(row => h('li', { key: row.pharmacyCode, 'data-queue': row.pharmacyCode },
        h('button', { type: 'button', className: 'c3-link', onClick: () => onSelect?.(row.pharmacyCode) }, row.pharmacyCode),
        h('span', { className: 'c3-queue-reasons' }, row.escalationReasons.join(' · ')),
        h('span', { className: 'c3-muted' }, row.score === null ? 'Not assessable' : `Score ${row.score.toFixed(1)}`)))));
}

function OverviewTable({ rows, sort, onSortChange, onSelect, selectedCode }) {
  return h('div', { className: 'c3-table-wrap' },
    h('table', { className: 'c3-ha-table' },
      h('caption', null, 'Accessible pharmacies. Select a pharmacy to open its detailed assessment.'),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Pharmacy'),
        h('th', { scope: 'col' }, 'Status'),
        h(SortHeader, { label: 'Score', sortKey: 'score', sort, onSortChange }),
        h(SortHeader, { label: 'Tier', sortKey: 'tier', sort, onSortChange }),
        h('th', { scope: 'col' }, 'Critical escalation'),
        h('th', { scope: 'col' }, 'Evidence items'))),
      h('tbody', null, rows.map(row => h('tr', {
        key: row.pharmacyCode,
        'data-row': row.pharmacyCode,
        'data-status': row.status,
        className: [row.pharmacyCode === selectedCode ? 'selected' : '', row.available ? '' : 'unavailable'].join(' ').trim() || undefined,
        onClick: () => onSelect?.(row.pharmacyCode),
      },
      h('th', { scope: 'row' }, h('button', {
        type: 'button',
        className: 'c3-link',
        onClick: event => { event.stopPropagation(); onSelect?.(row.pharmacyCode); },
      }, row.pharmacyCode)),
      h('td', { title: row.error || undefined }, statusText(row)),
      h('td', { className: 'c3-num', 'data-cell': 'score' }, scoreText(row)),
      h('td', { 'data-cell': 'tier' }, row.tier ? TIER_LABELS[row.tier] : ''),
      h('td', { className: row.criticalEscalationRequired ? 'c3-critical' : undefined }, criticalText(row)),
      h('td', { className: 'c3-num' }, row.evidenceCount === null ? '—' : row.evidenceCount))))));
}

/** Health-authority overview: summary, tier distribution, escalation queue and pharmacy table. */
export function HealthAuthorityView({ rows = [], sort = { key: 'score', direction: 'desc' }, onSortChange, onSelect, onRefresh, loading = false, error = '', selectedCode = '' }) {
  const summary = overviewSummary(rows);
  return h('section', { className: 'c3-ha', 'aria-labelledby': 'c3-ha-title' },
    h('div', { className: 'c3-section-title' },
      h('div', null,
        h('p', { className: 'c3-eyebrow' }, 'HEALTH AUTHORITY OVERVIEW'),
        h('h2', { id: 'c3-ha-title' }, 'Pharmacy trust overview'),
        h('p', { className: 'c3-muted c3-ha-note' }, 'Decision support, not a regulatory determination.')),
      onRefresh ? h('button', { type: 'button', className: 'c3-secondary', onClick: onRefresh, disabled: loading }, loading ? 'Loading…' : 'Refresh overview') : null),
    error ? h('div', { className: 'c3-state c3-error', role: 'alert' }, h('strong', null, 'Overview unavailable'), h('p', null, error)) : null,
    loading && rows.length === 0 ? h('div', { className: 'c3-state c3-loading', role: 'status' }, h('span', { className: 'c3-spinner' }), ' Loading pharmacy assessments…') : null,
    rows.length > 0 ? h(Fragment, null,
      h(SummaryHeader, { summary }),
      h('div', { className: 'c3-ha-grid' },
        h(TierDistribution, { counts: tierDistribution(rows), total: rows.length }),
        h(EscalationQueue, { queue: escalationQueue(rows), onSelect })),
      h(OverviewTable, { rows: sortRows(rows, sort), sort, onSortChange, onSelect, selectedCode })) : null);
}

/** Collapsed validation summary; numbers come from the committed validationSummary.json snapshot. */
export function ValidationSummaryPanel({ summary }) {
  if (!summary) return null;
  const { functional, scenarios, equalWeightBaseline: b, oneAtATime: o, globalStressTest: g } = summary;
  const item = (label, value) => h(Fragment, { key: label }, h('dt', null, label), h('dd', null, value));
  return h('details', { className: 'c3-card c3-validation' },
    h('summary', null, 'Validation summary (simulated profiles)'),
    h('p', { className: 'c3-muted' },
      'Results from simulated pharmacy profiles. They show computational correctness and robustness to weight assumptions, not real-world accuracy.'),
    h('dl', { className: 'c3-validation-list' },
      item('Functional tests', `${functional.casesPassed}/${functional.casesTotal} cases passed (${functional.checksPassed}/${functional.checksTotal} checks)`),
      item('Scenario checks', `${scenarios.checksPassed}/${scenarios.checksTotal} passed across ${scenarios.profiles} simulated profiles`),
      item('Equal-weight baseline', `Spearman ${fmt(b.spearmanRho)}; tier-switch rate ${pct(b.tierSwitchRate)} (${b.tierSwitches} of ${b.profilesCompared})`),
      item('One-at-a-time sensitivity (±5%, ±10%)', `Spearman ${fmt(o.spearmanMin)}–${fmt(o.spearmanMax)}; max score change ${fmt(o.maxAbsScoreChange, 2)}; tier-switch rate ${pct(o.tierSwitchRateMin)}–${pct(o.tierSwitchRateMax)} over ${o.runs} runs`),
      item('Global stress test', `${g.draws} random weightings: mean Spearman ${fmt(g.spearmanMean)} (5th percentile ${fmt(g.spearmanP05)}); tier stability ${pct(g.overallTierStability)}`),
      item('AHP', summary.ahp.status)));
}
