/** White rounded card (16px radius, soft border and shadow). */
export default function Card({ title, as = 'section', className = '', children, ...rest }) {
  const Tag = as;
  return <Tag className={`c3-ui-card ${className}`.trim()} {...rest}>
    {title && <h2 className="c3-ui-card-title">{title}</h2>}
    {children}
  </Tag>;
}
