import { Icon } from './icons.jsx';

/** Top bar: page title, connection status (dot + text), provenance chip, role badge, sign out. */
export default function TopBar({ title, status, provenanceChip, roleLabel, onSignOut, signOutLabel = 'Sign out', menu }) {
  return <header className="c3-topbar">
    {menu && <button type="button" className="c3-menu-button" aria-label={menu.open ? 'Close navigation' : 'Open navigation'}
      aria-expanded={menu.open} aria-controls={menu.controls} onClick={menu.onToggle}>
      <Icon name={menu.open ? 'close' : 'menu'} size={20}/></button>}
    <h1 className="c3-topbar-title">{title}</h1>
    <div className="c3-topbar-right">
      {status && <span className={`c3-status-dot ${status.tone}`} role="status">{status.label}</span>}
      {provenanceChip}
      {roleLabel && <span className="c3-role-badge">{roleLabel}</span>}
      {onSignOut && <button type="button" className="c3-secondary c3-logout" onClick={onSignOut}>{signOutLabel}</button>}
    </div>
  </header>;
}
