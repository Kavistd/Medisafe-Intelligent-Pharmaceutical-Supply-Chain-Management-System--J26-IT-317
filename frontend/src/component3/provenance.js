import { createElement } from 'react';

// Display-only wording. API field names and values are never changed; these
// labels only replace raw codes in rendered text.
const DISPLAY_LABELS = Object.freeze({
  SYNTHETIC: 'Simulated sample',
  SYNTHETIC_TEST_DATA: 'Simulated sample',
  LOCAL_SYNTHETIC_DEMO: 'Simulated sample dataset',
  DECLARED_REAL_UNVERIFIED: 'Declared source (unverified)',
  REAL: 'Declared source (unverified)',
  MIXED: 'Mixed evidence',
  NOT_PERFORMED: 'Not performed',
});

export function displayLabel(value) {
  if (typeof value !== 'string' || !value) return 'Unavailable';
  return DISPLAY_LABELS[value] || value;
}

const SYNTHETIC_DEMO_LABEL = 'LOCAL_SYNTHETIC_DEMO';

const PROVENANCE = Object.freeze({
  SIMULATED: Object.freeze({
    kind: 'simulated',
    label: 'Simulated sample dataset',
    detail: 'All values come from simulated sample records generated for this research prototype. They are not real pharmacy data.',
  }),
  MIXED: Object.freeze({
    kind: 'mixed',
    label: 'Mixed evidence',
    detail: 'This assessment combines simulated sample records with declared source records. Declared sources have not been independently verified.',
  }),
  DECLARED_REAL: Object.freeze({
    kind: 'declared',
    label: 'Declared source records (unverified)',
    detail: 'Records are labelled as real by their source system. Their authenticity has not been independently verified.',
  }),
  UNKNOWN: Object.freeze({
    kind: 'unknown',
    label: 'Provenance unavailable',
    detail: 'The API did not report where this data came from. Treat it as unverified.',
  }),
});

/**
 * Decide the single provenance notice for the current view. Any synthetic
 * signal (demo mode, the demo label on any resource, or a SYNTHETIC evidence
 * source) always yields the simulated notice. Overview entries count as data on
 * screen exactly like the detail bundle. Returns null only when no data is on
 * screen and the view is not the sample-data demo.
 */
export function resolveProvenance({ mode, bundle, overview } = {}) {
  const overviewResources = (Array.isArray(overview) ? overview : [])
    .filter(entry => entry?.available)
    .flatMap(entry => [entry.assessment, entry.criticalFindings]);
  const resources = [bundle?.assessment, bundle?.evidence, bundle?.criticalFindings, ...overviewResources]
    .filter(item => item && typeof item === 'object');
  const sources = resources.map(item => item.evidenceSource).filter(Boolean);
  const demoLabelled = resources.some(item => item.demoLabel === SYNTHETIC_DEMO_LABEL);

  if (mode === 'demo' || demoLabelled) return PROVENANCE.SIMULATED;
  if (!bundle && overviewResources.length === 0) return null;
  if (sources.includes('MIXED')) return PROVENANCE.MIXED;
  if (sources.includes('SYNTHETIC') && sources.some(source => source !== 'SYNTHETIC')) return PROVENANCE.MIXED;
  if (sources.includes('SYNTHETIC')) return PROVENANCE.SIMULATED;
  if (sources.length > 0 && sources.every(source => source === 'REAL')) return PROVENANCE.DECLARED_REAL;
  return PROVENANCE.UNKNOWN;
}

/** Small, muted, always-visible provenance chip; the tooltip carries the details. */
export function ProvenanceChip({ provenance }) {
  if (!provenance) return null;
  return createElement('span', {
    className: `c3-chip c3-chip-${provenance.kind}`,
    title: provenance.detail,
    'aria-label': `Data provenance: ${provenance.label}. ${provenance.detail}`,
    'data-provenance': provenance.kind,
  }, createElement('span', { className: 'c3-chip-dot', 'aria-hidden': 'true' }), provenance.label);
}
