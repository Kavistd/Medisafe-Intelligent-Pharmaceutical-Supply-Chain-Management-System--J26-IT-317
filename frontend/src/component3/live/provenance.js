import { createElement } from 'react';

/**
 * Provenance notice for the LIVE workspaces (the sample-mode chip in ../provenance.js
 * is unchanged). Live data is seeded simulation plus entries made in this prototype;
 * none of it is real-world verified, and it is never labelled as real.
 */
export const LIVE_PROVENANCE_LABEL = 'Prototype dataset (seeded simulation + entries made in this prototype)';

const CLASS_TEXT = Object.freeze({
  SEEDED_SIMULATED: 'seeded simulation',
  PROTOTYPE_ENTRY: 'entries made in this prototype',
});

/** Tooltip/detail text; optionally names the evidence classes an assessment actually used. */
export function liveProvenanceDetail(evidenceClasses) {
  const used = (Array.isArray(evidenceClasses) ? evidenceClasses : []).map(item => CLASS_TEXT[item]).filter(Boolean);
  const usedText = used.length ? ` This view uses: ${used.join(' and ')}.` : '';
  return `Live prototype data. Seeded simulation records and entries made in this prototype are not real-world verified.${usedText}`;
}

export function LiveProvenanceChip({ evidenceClasses } = {}) {
  const detail = liveProvenanceDetail(evidenceClasses);
  return createElement('span', {
    className: 'c3-chip c3-chip-prototype',
    title: detail,
    'aria-label': `Data provenance: ${LIVE_PROVENANCE_LABEL}. ${detail}`,
    'data-provenance': 'prototype',
  }, createElement('span', { className: 'c3-chip-dot', 'aria-hidden': 'true' }), LIVE_PROVENANCE_LABEL);
}
