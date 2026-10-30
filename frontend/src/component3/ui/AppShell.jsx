import { useEffect, useState } from 'react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import './tokens.css';
import './shell.css';

const SIDEBAR_ID = 'c3-sidebar';

/**
 * Layout only: fixed left sidebar (a top drawer under 900px), sticky top bar and a content slot.
 * `bare` renders a centred single-column layout (sign-in and access-check screens).
 */
export default function AppShell({ nav = [], activeId, onNavigate, title, status, provenanceChip, roleLabel, onSignOut, signOutLabel, bare = false, sidebarFooter, children }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const navigate = (id, isAnchor) => { setOpen(false); if (!isAnchor) onNavigate?.(id); };
  const showSidebar = !bare;

  return <div className={`c3-shell c3-app${bare ? ' bare' : ''}`}>
    <a className="c3-skip" href="#c3-main">Skip to content</a>
    {showSidebar && <Sidebar id={SIDEBAR_ID} groups={nav} activeId={activeId} onNavigate={navigate} open={open} footer={sidebarFooter}/>}
    {showSidebar && open && <button type="button" className="c3-scrim" aria-label="Close navigation" onClick={() => setOpen(false)}/>}
    <div className="c3-main">
      <TopBar title={title} status={status} provenanceChip={provenanceChip} roleLabel={roleLabel} onSignOut={onSignOut} signOutLabel={signOutLabel}
        menu={showSidebar ? { open, controls: SIDEBAR_ID, onToggle: () => setOpen(value => !value) } : null}/>
      <main id="c3-main" className="c3-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
