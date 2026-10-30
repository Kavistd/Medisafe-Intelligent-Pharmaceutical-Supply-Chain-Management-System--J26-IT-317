import { createElement as h } from 'react';
import { parseFraction } from './uiModel.js';

/** Indicator as "D 7/10" with a thin progress bar; non-fractions (e.g. "Not assessable") show text only, never 0. */
export function IndicatorChip({ letter, text }) {
  const fraction = parseFraction(text);
  const label = `${letter}: ${text}`;
  return h('span', { className: `c3-ind-chip${fraction ? '' : ' na'}`, title: label, 'aria-label': label },
    h('span', { className: 'c3-ind-letter', 'aria-hidden': 'true' }, letter),
    h('span', { className: 'c3-ind-value', 'aria-hidden': 'true' }, text),
    fraction ? h('span', { className: 'c3-ind-bar', 'aria-hidden': 'true' },
      h('span', { style: { width: `${Math.round(fraction.ratio * 100)}%` } })) : null);
}
