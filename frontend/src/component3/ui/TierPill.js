import { createElement as h } from 'react';
import { tierTone } from './uiModel.js';

/** Tier as a rounded text pill. The label text is always rendered; colour only supplements it. */
export function TierPill({ label }) {
  const text = typeof label === 'string' && label.trim() ? label : 'Not assessable';
  return h('span', { className: `c3-tier-pill ${tierTone(text)}`, 'data-tier-pill': text }, text);
}
