import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import ReactDOMServer from 'react-dom/server';
import { LIVE_PROVENANCE_LABEL, LiveProvenanceChip, liveProvenanceDetail } from './provenance.js';
import { resolveProvenance } from '../provenance.js';

const render = props => ReactDOMServer.renderToStaticMarkup(createElement(LiveProvenanceChip, props));

test('the live chip uses the prototype-dataset wording', () => {
  assert.equal(LIVE_PROVENANCE_LABEL, 'Prototype dataset (seeded simulation + entries made in this prototype)');
  const html = render({});
  assert.match(html, /Prototype dataset \(seeded simulation \+ entries made in this prototype\)/);
  assert.match(html, /data-provenance="prototype"/);
  assert.match(html, /not real-world verified/);
  assert.equal(html.match(/data-provenance=/g).length, 1);
});

test('live provenance never says REAL and never uses the sample-mode wording', () => {
  for (const classes of [undefined, [], ['SEEDED_SIMULATED'], ['PROTOTYPE_ENTRY'], ['PROTOTYPE_ENTRY', 'SEEDED_SIMULATED'], ['REAL']]) {
    const html = render({ evidenceClasses: classes });
    assert.doesNotMatch(html, /\bREAL\b/);
    assert.doesNotMatch(html, /Simulated sample dataset/);
    assert.doesNotMatch(liveProvenanceDetail(classes), /\bREAL\b|Simulated sample dataset/);
  }
  assert.match(liveProvenanceDetail(['SEEDED_SIMULATED', 'PROTOTYPE_ENTRY']), /seeded simulation and entries made in this prototype/);
});

test('the sample-mode chip is unchanged', () => {
  assert.equal(resolveProvenance({ mode: 'demo', bundle: null }).label, 'Simulated sample dataset');
});
