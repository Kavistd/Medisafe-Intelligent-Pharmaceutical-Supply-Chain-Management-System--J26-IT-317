import Card from '../ui/Card.jsx';
import { TierPill } from '../ui/TierPill.js';
import { TIER_LABELS } from './liveModel.js';
import { improvementPath } from './improvement.js';

const fraction = row => `${Number.isInteger(row.numerator) ? row.numerator : row.numerator.toFixed(1)}/${row.denominator}`;

/** "Improvement path": indicative what-if from the calculation already loaded. Decision support only. */
export default function ImprovementPanel({ data, criticalEscalation }) {
  const path = improvementPath(data, { criticalEscalation });
  return <Card as="section" className="c3-improve" aria-labelledby="c3-improve-title">
    <h3 id="c3-improve-title" className="c3-live-subtitle">Improvement path</h3>

    {path.kind !== 'NOT_ENOUGH_EVIDENCE' && <dl className="c3-improve-tiers">
      <div><dt>Current tier</dt><dd><TierPill label={TIER_LABELS[path.currentTier]}/></dd></div>
      <div><dt>Next tier target</dt><dd>{path.nextTier
        ? <><TierPill label={TIER_LABELS[path.nextTier]}/> <span className="c3-muted">from {path.nextTierMinimum} · {path.pointsNeeded.toFixed(1)} points to go</span></>
        : <span className="c3-muted">Already in the highest tier</span>}</dd></div>
    </dl>}

    <p className="c3-improve-message"><strong>{path.message}</strong></p>
    {path.kind === 'PLAN' && <p className="c3-muted">{path.caveat}</p>}

    {path.kind === 'PLAN' && <div className="c3-table-wrap">
      <table className="c3-ha-table c3-live-table">
        <caption>If only one area improved. {path.caveat}</caption>
        <thead><tr><th scope="col">Area</th><th scope="col">Now</th><th scope="col">More needed in this area alone</th></tr></thead>
        <tbody>{path.indicators.map(row => <tr key={row.key}>
          <th scope="row">{row.letter} · {row.label}</th>
          <td className="c3-num">{fraction(row)}</td>
          <td>{row.reachableAlone ? `About ${row.kAlone} more ${row.unit}` : <span className="c3-muted">Not reachable by this indicator alone</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>}

    {path.weakest && path.kind === 'PLAN' && <p className="c3-improve-hint">
      Weakest area: <strong>{path.weakest.label}</strong> has the largest weighted gap to full performance. Progress there is measured in {path.weakest.unit}.
    </p>}

    {path.escalationNotice && <p className="c3-improve-escalation" role="note"><span className="c3-flag-warn">Critical escalation</span> {path.escalationNotice}</p>}
    <p className="c3-muted c3-improve-foot">Decision support only. This what-if does not change the recorded score, tier or escalation.</p>
  </Card>;
}
