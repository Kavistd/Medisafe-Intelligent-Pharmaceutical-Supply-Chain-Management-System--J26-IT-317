import Skeleton from '../ui/Skeleton.jsx';

/** Small shared presentation pieces for the live workspaces (loading, empty, error and action states). */
const FALLBACK = 'The request could not be completed. Try again shortly.';

export function ResourceState({ resource, emptyText = 'Nothing to show yet.', isEmpty, children }) {
  if (resource.loading && !resource.data) {
    return <Skeleton label="Loading…"/>;
  }
  if (resource.error) {
    return <div className="c3-state c3-error" role="alert"><strong>Could not load</strong><p>{resource.error.message || FALLBACK}</p>
      <button type="button" className="c3-secondary" onClick={resource.reload}>Try again</button></div>;
  }
  if (isEmpty ? isEmpty(resource.data) : (Array.isArray(resource.data) && resource.data.length === 0)) {
    return <div className="c3-live-empty"><span className="c3-live-empty-mark" aria-hidden="true">○</span><p>{emptyText}</p></div>;
  }
  return children(resource.data);
}

export function ActionStatus({ action }) {
  if (action.error) return <p className="c3-live-alert" role="alert">{action.error.message || FALLBACK}</p>;
  if (action.success) return <p className="c3-live-success" role="status">{action.success}</p>;
  return null;
}

export function FieldError({ id, message }) {
  return message ? <small id={id} className="c3-live-field-error" role="alert">{message}</small> : null;
}

/** Shown when the shell asks for a section the session's allowedActions do not include. */
export function SectionUnavailable() {
  return <div className="c3-state c3-empty" role="status"><strong>Section not available</strong>
    <p>This section is not included in your Component 3 role. The server enforces every permission.</p></div>;
}

export function Section({ eyebrow, title, actions, children }) {
  return <section className="c3-card c3-live-section">
    <div className="c3-section-title"><div>{eyebrow && <p className="c3-eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{actions}</div>
    {children}
  </section>;
}
