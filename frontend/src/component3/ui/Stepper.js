import { createElement as h } from 'react';
import { stepState } from './uiModel.js';

const STATE_TEXT = { done: 'Done', current: 'Current', upcoming: 'Next' };

/** Numbered process stepper (visual guide only; it does not gate or change the form). */
export function Stepper({ steps, label = 'Progress' }) {
  const list = Array.isArray(steps) ? steps : [];
  const states = stepState(list.map(step => Boolean(step.done)));
  return h('ol', { className: 'c3-stepper', 'aria-label': label },
    list.map((step, index) => h('li', {
      key: step.label,
      className: `c3-step ${states[index]}`,
      ...(states[index] === 'current' ? { 'aria-current': 'step' } : {}),
    },
    h('span', { className: 'c3-step-num', 'aria-hidden': 'true' }, states[index] === 'done' ? '✓' : String(index + 1)),
    h('span', null, step.label),
    h('span', { className: 'c3-step-state' }, STATE_TEXT[states[index]]))));
}
