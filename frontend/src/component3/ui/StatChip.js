import { createElement as h } from 'react';

const TONES = new Set(['ok', 'info', 'warn', 'danger', 'neutral']);

/** Small text stat chip; the tone dot is decorative, the label carries the meaning. */
export function StatChip({ label, tone = 'neutral' }) {
  return h('li', { className: `c3-stat-chip ${TONES.has(tone) ? tone : 'neutral'}` }, label);
}

export function StatChipList({ stats, label = 'Summary' }) {
  if (!Array.isArray(stats) || stats.length === 0) return null;
  return h('ul', { className: 'c3-hero-stats', 'aria-label': label }, stats.map(stat => h(StatChip, { key: stat.label, ...stat })));
}
