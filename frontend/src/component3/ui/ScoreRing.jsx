/** Score gauge ring. A NOT_ASSESSABLE assessment shows text, never a 0 ring. */
export default function ScoreRing({ score, assessable, scoreText }) {
  const size = 132;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const ratio = assessable && Number.isFinite(score) ? Math.max(0, Math.min(1, score / 100)) : 0;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
    aria-label={assessable ? `Trust score ${scoreText} out of 100` : 'Trust score: Not assessable'}>
    <defs><linearGradient id="c3-ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'var(--c3-accent)' }}/><stop offset="1" style={{ stopColor: 'var(--c3-accent-2)' }}/></linearGradient></defs>
    <circle className="c3-ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="12"/>
    {assessable && <circle className="c3-ring-value" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="12" strokeLinecap="round"
      strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>}
    {assessable
      ? <><text className="c3-ring-label" x="50%" y="52%" textAnchor="middle">{scoreText}</text>
        <text className="c3-ring-sub" x="50%" y="68%" textAnchor="middle">of 100</text></>
      : <text className="c3-ring-sub" x="50%" y="54%" textAnchor="middle">Not assessable</text>}
  </svg>;
}
