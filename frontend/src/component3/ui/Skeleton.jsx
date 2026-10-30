/** Loading placeholder with a shimmer (disabled under prefers-reduced-motion). */
export default function Skeleton({ label = 'Loading…', lines = 3 }) {
  return <div className="c3-skeleton" role="status" aria-live="polite">
    <span className="c3-sr-only">{label}</span>
    {Array.from({ length: lines }, (_unused, index) => <span key={index} aria-hidden="true"/>)}
  </div>;
}
