import { Icon, LogoMark } from './icons.jsx';

/**
 * Left sidebar: logo + grouped navigation. Items with `href` are in-page anchors;
 * others call onNavigate(id). Only the links passed in are rendered (filtered upstream).
 */
export default function Sidebar({ id, groups = [], activeId, onNavigate, open, footer }) {
  return <aside id={id} className={`c3-sidebar${open ? ' open' : ''}`} aria-label="Component 3 navigation">
    <a className="c3-logo" href="/" aria-label="MediSafe Chain home">
      <LogoMark/>
      <span className="c3-logo-text"><strong>MediSafe Chain</strong><small>Pharmacy trust</small></span>
    </a>
    {groups.length > 0 && <nav aria-label="Workspace sections">
      {groups.map(group => <div key={group.group} className="c3-nav-group">
        <p className="c3-nav-label">{group.group}</p>
        {group.items.map(item => item.href
          ? <a key={item.id} className="c3-nav-item" href={item.href} onClick={() => onNavigate?.(item.id, true)}>
            <Icon name={item.icon}/><span>{item.label}</span></a>
          : <button key={item.id} type="button" className="c3-nav-item" aria-current={item.id === activeId ? 'page' : undefined}
            onClick={() => onNavigate?.(item.id)}>
            <Icon name={item.icon}/><span>{item.label}</span></button>)}
      </div>)}
    </nav>}
    {footer && <div className="c3-sidebar-foot">{footer}</div>}
  </aside>;
}
