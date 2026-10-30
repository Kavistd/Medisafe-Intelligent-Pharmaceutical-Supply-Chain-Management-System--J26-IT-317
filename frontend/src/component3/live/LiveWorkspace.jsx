import { workspaceForSession } from './liveModel.js';
import RegulatorWorkspace from './RegulatorWorkspace.jsx';
import PharmacyWorkspace from './PharmacyWorkspace.jsx';
import DistributorWorkspace from './DistributorWorkspace.jsx';
import './live.css';

/**
 * Renders the workspace for the role the SERVER resolved in GET /api/v1/live/session.
 * There is no role picker; anything unexpected fails closed. The role badge and Sign out
 * live in the app shell's top bar; `section` comes from the shell's sidebar.
 */
export default function LiveWorkspace({ session, client, onSessionExpired, section, onNavigate }) {
  const workspace = workspaceForSession(session);
  const props = { client, session, onAuthError: onSessionExpired, section, onNavigate };
  return <div className="c3-live">
    {workspace === 'regulator' && <RegulatorWorkspace {...props}/>}
    {workspace === 'pharmacy' && <PharmacyWorkspace {...props}/>}
    {workspace === 'distributor' && <DistributorWorkspace {...props}/>}
    {!workspace && <div className="c3-state c3-error" role="alert"><strong>Component 3 access could not be checked</strong>
      <p>The server did not return an active Component 3 role for this account. No data is shown.</p></div>}
  </div>;
}
