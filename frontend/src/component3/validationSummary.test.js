import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import ReactDOMServer from 'react-dom/server';
import { summarizeValidationResults } from './validationSummary.js';
import { ValidationSummaryPanel } from './HealthAuthorityView.js';

const readJson = relative => JSON.parse(fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const results = readJson('../../../validation/component3/results/results.json');
const snapshot = readJson('./validationSummary.json');

test('the dashboard snapshot matches validation/component3/results/results.json exactly', () => {
  assert.deepEqual(snapshot, summarizeValidationResults(results),
    'validationSummary.json has drifted from results.json; regenerate it with summarizeValidationResults.');
});

test('the snapshot keeps the synthetic-data banner and the AHP status', () => {
  assert.match(snapshot.banner[0], /SYNTHETIC DATA - NOT REAL PHARMACY DATA/);
  assert.match(snapshot.banner[2], /do not show real-world accuracy/i);
  assert.equal(snapshot.ahp.status, 'AHP: tooling ready, expert responses not yet collected');
});

test('the panel is collapsed and states what the results do and do not show', () => {
  const html = ReactDOMServer.renderToStaticMarkup(createElement(ValidationSummaryPanel, { summary: snapshot }));
  assert.match(html, /^<details/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /Validation summary \(simulated profiles\)/);
  assert.match(html, /computational correctness and robustness to weight assumptions, not real-world accuracy/);
  assert.match(html, /AHP: tooling ready, expert responses not yet collected/);
  const { functional, scenarios, equalWeightBaseline } = snapshot;
  assert.match(html, new RegExp(`${functional.casesPassed}/${functional.casesTotal} cases passed`));
  assert.match(html, new RegExp(`${scenarios.checksPassed}/${scenarios.checksTotal} passed across ${scenarios.profiles}`));
  assert.match(html, new RegExp(`Spearman ${equalWeightBaseline.spearmanRho.toFixed(3)}`));
});
