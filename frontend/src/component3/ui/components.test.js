import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import ReactDOMServer from 'react-dom/server';
import { TierPill } from './TierPill.js';
import { IndicatorChip } from './IndicatorChip.js';
import { StatChipList } from './StatChip.js';
import { Stepper } from './Stepper.js';
import { TIER_LABELS, regulatorRow } from '../live/liveModel.js';

const render = (component, props) => ReactDOMServer.renderToStaticMarkup(createElement(component, props));
const text = html => html.replace(/<[^>]+>/g, '');

test('TierPill always renders the tier as text', () => {
  for (const label of Object.values(TIER_LABELS)) {
    const html = render(TierPill, { label });
    assert.equal(text(html), label);
    assert.match(html, /class="c3-tier-pill (ok|info|warn|danger|neutral)"/);
  }
});

test('TierPill with a missing label renders "Not assessable", never blank or 0', () => {
  for (const label of [undefined, null, '', '   ']) {
    assert.equal(text(render(TierPill, { label })), 'Not assessable');
  }
});

test('IndicatorChip shows a fraction with a proportional bar', () => {
  const html = render(IndicatorChip, { letter: 'D', text: '7/10' });
  assert.match(html, /aria-label="D: 7\/10"/);
  assert.match(html, /width:70%/);
  assert.ok(text(html).includes('7/10'));
});

test('IndicatorChip never renders Not assessable as 0 or as a bar', () => {
  for (const value of ['Not assessable', 'Unavailable']) {
    const html = render(IndicatorChip, { letter: 'R', text: value });
    assert.ok(text(html).includes(value));
    assert.doesNotMatch(html, /c3-ind-bar/);
    assert.doesNotMatch(text(html), /\b0\b/);
    assert.match(html, /c3-ind-chip na/);
  }
});

test('regulator rows keep NOT_ASSESSABLE as text through the chips and pill', () => {
  const row = regulatorRow({ pharmacyId: 'C3-PH-X', status: 'NOT_ASSESSABLE', score: null, tier: 'NOT_ASSESSABLE' }, null);
  assert.equal(row.scoreText, 'Not assessable');
  assert.equal(text(render(TierPill, { label: row.tierText })), 'Not assessable');
  for (const item of row.indicators) assert.doesNotMatch(render(IndicatorChip, item), /c3-ind-bar/);
});

test('StatChipList renders labelled text chips and nothing when empty', () => {
  const html = render(StatChipList, { stats: [{ label: '3 pharmacies', tone: 'neutral' }, { label: '1 escalation', tone: 'danger' }], label: 'Summary' });
  assert.match(html, /<ul class="c3-hero-stats" aria-label="Summary">/);
  assert.match(html, /<li class="c3-stat-chip danger">1 escalation<\/li>/);
  assert.equal(render(StatChipList, { stats: [] }), '');
});

test('Stepper numbers steps, marks the current one and states each step in text', () => {
  const html = render(Stepper, { label: 'Recall steps', steps: [{ label: 'Select', done: true }, { label: 'Review', done: false }, { label: 'Submit', done: false }] });
  assert.match(html, /<ol class="c3-stepper" aria-label="Recall steps">/);
  assert.match(html, /class="c3-step current" aria-current="step"/);
  assert.equal((html.match(/aria-current/g) || []).length, 1);
  assert.ok(text(html).includes('SelectDone'));
  assert.ok(text(html).includes('2ReviewCurrent'));
  assert.ok(text(html).includes('3SubmitNext'));
});
