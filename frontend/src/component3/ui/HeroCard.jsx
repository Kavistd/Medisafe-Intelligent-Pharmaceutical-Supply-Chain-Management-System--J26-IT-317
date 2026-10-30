import { StatChipList } from './StatChip.js';

/** Hero card: pill badge, heading with a gradient phrase, one-line description and stat chips. */
export default function HeroCard({ badge, title, highlight, description, stats, as = 'h2', children }) {
  const Heading = as;
  return <section className="c3-hero" aria-label={badge || title}>
    {badge && <span className="c3-hero-badge">{badge}</span>}
    <Heading>{title}{highlight && <> <span className="c3-gradient-text">{highlight}</span></>}</Heading>
    {description && <p>{description}</p>}
    <StatChipList stats={stats} label={`${title} summary`}/>
    {children}
  </section>;
}
