import { calculationView, formatTime } from './liveModel.js';

/** Score, tier and "How this score was calculated" for one pharmacy (from the calculation route). */
export default function CalculationPanel({ data, findings }) {
  const view = calculationView(data);
  const escalation = findings && typeof findings.required === 'boolean' ? findings.required : view.criticalEscalationRequired;
  return <div className="c3-live-calc">
    <div className="c3-summary-grid c3-live-summary">
      <article className="c3-score-card">
        <p className="c3-eyebrow">TRUST SCORE</p><h3 className="c3-live-pharmacy">{view.pharmacyId}</h3>
        {view.status === 'ASSESSABLE'
          ? <div className="c3-score-line"><strong>{view.scoreText}</strong><span>/ 100</span></div>
          : <><div className="c3-score-na">NOT ASSESSABLE</div>
            <p className="c3-not-assessable-explanation">Missing evidence for: {view.missing.join(', ') || 'one or more indicators'}. Missing evidence is never scored as 0 or 100, and the remaining weights are not renormalised.</p></>}
        <p className="c3-live-tier">Tier: <strong>{view.tierText}</strong></p>
        <p className="c3-chain-note">Assessed {formatTime(view.asOf)} · Blockchain verification: NOT PERFORMED</p>
      </article>
      <article className={`c3-escalation-card ${escalation ? 'alert' : ''}`}>
        <p className="c3-eyebrow">SEPARATE REGULATORY SIGNAL</p><h3>Critical findings</h3>
        <p className="c3-escalation-state">{escalation ? 'Escalation required' : 'No critical escalation recorded'}</p>
        {Array.isArray(findings?.findings) && findings.findings.length > 0 && <ul className="c3-finding-list">
          {findings.findings.map(finding => <li key={finding.id}><strong>{finding.description}</strong>{finding.criterionCode && <small>Criterion: {finding.criterionCode}</small>}</li>)}
        </ul>}
        <p className="c3-muted">Escalation is shown separately and does not change the score.</p>
      </article>
    </div>

    <h3 className="c3-live-subtitle">How this score was calculated</h3>
    <div className="c3-table-wrap">
      <table className="c3-ha-table c3-live-table">
        <caption>Weighted sum of four indicators. Weights are {view.policyLabel}.</caption>
        <thead><tr><th scope="col">Indicator</th><th scope="col">Weight</th><th scope="col">Counted</th><th scope="col">Value</th><th scope="col">Weighted contribution</th></tr></thead>
        <tbody>{view.indicators.map(row => <tr key={row.key}>
          <th scope="row">{row.letter} · {row.label}</th>
          <td className="c3-num">{row.weightText}</td>
          <td className="c3-num">{row.fractionText}</td>
          <td className="c3-num">{row.valueText}</td>
          <td className="c3-num">{row.contributionText}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {view.indicators.map(row => <details key={row.key} className="c3-live-details">
      <summary>{row.label}: records counted and excluded</summary>
      {row.formula && <p className="c3-muted">{row.formula}</p>}
      {row.failures.length > 0 && <><p className="c3-live-list-title">Counted as not met ({row.failures.length})</p>
        <ul className="c3-list">{row.failures.map(item => <li key={item.id}><code>{item.id}</code>: {item.reason}</li>)}</ul></>}
      {row.excluded.length > 0 && <><p className="c3-live-list-title">Excluded ({row.excluded.length})</p>
        <ul className="c3-list">{row.excluded.map(item => <li key={item.id}><code>{item.id}</code>: {item.reason}</li>)}</ul></>}
      {row.notes.length > 0 && <ul className="c3-list">{row.notes.map(item => <li key={item.id}><code>{item.id}</code>: {item.reason}</li>)}</ul>}
      {row.notApplicable > 0 && <p className="c3-muted">{row.notApplicable} not-applicable item(s) excluded from the maximum points.</p>}
      {row.failures.length + row.excluded.length + row.notes.length === 0 && <p className="c3-muted">No exclusions or unmet records.</p>}
    </details>)}
  </div>;
}
