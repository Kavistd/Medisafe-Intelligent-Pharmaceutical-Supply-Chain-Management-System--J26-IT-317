import { useId, useState } from 'react';
import { chipText, refsFor } from './guidelineRefs.js';

/** Compact "Basis" row of section-level guideline chips; each chip expands its details (button + aria-expanded). */
export default function GuidelineChips({ refsKey, label = 'Basis' }) {
  const refs = refsFor(refsKey);
  const [open, setOpen] = useState(null);
  const baseId = useId();
  if (refs.length === 0) return null;
  const panelId = `${baseId}-detail`;
  const current = open === null ? null : refs[open];
  return <div className="c3-basis">
    <span className="c3-basis-label">{label}</span>
    <ul className="c3-basis-chips">{refs.map((entry, index) => <li key={`${entry.code}-${entry.page}-${entry.section}`}>
      <button type="button" className="c3-basis-chip" aria-expanded={open === index} aria-controls={panelId}
        onClick={() => setOpen(value => (value === index ? null : index))}>{chipText(entry)}</button>
    </li>)}</ul>
    <div id={panelId} className="c3-basis-detail" hidden={!current}>
      {current && <p><strong>{current.code} · {current.title}</strong>, {current.page}, {current.section}. {current.note}</p>}
    </div>
  </div>;
}
