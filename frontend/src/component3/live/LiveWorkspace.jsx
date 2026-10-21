import { workspaceForSession } from './liveModel.js';
import RegulatorWorkspace from './RegulatorWorkspace.jsx';
import PharmacyWorkspace from './PharmacyWorkspace.jsx';
import DistributorWorkspace from './DistributorWorkspace.jsx';
import './live.css';

const ROLE_TEXT = { regulator: 'Regulator', pharmacy: 'Pharmacy user', distributor: 'Distributor' };

/**
 * Renders the workspace for the role the SERVER resolved in GET /api/v1/live/session.
 * There is no role picker; anything unexpected fails closed.
 */
export default function LiveWorkspace({ session, client, onSignOut, onSessionExpired }) {
  const workspace = workspaceForSession(session);
  const scope = session?.pharmacy?.code || session?.distributor?.code || null;
  return <div className="c3-live">
    <section className="c3-card c3-search-card">
      <div className="c3-access-heading">
        <div><p className="c3-eyebrow">LIVE WORKSPACE</p>
          <h2>{workspace ? ROLE_TEXT[workspace] : 'No workspace available'}{scope ? ` · ${scope}` : ''}</h2>
          <p className="c3-helper">Your role is assigned by Component 3 provisioning and checked by the server on every request.</p></div>
        <button type="button" className="c3-secondary c3-logout" onClick={onSignOut}>Sign out</button>
      </div>
    </section>
    {workspace === 'regulator' && <RegulatorWorkspace client={client} session={session} onAuthError={onSessionExpired}/>}
    {workspace === 'pharmacy' && <PharmacyWorkspace client={client} session={session} onAuthError={onSessionExpired}/>}
    {workspace === 'distributor' && <DistributorWorkspace client={client} session={session} onAuthError={onSessionExpired}/>}
    {!workspace && <div className="c3-state c3-error" role="alert"><strong>Component 3 access could not be checked</strong>
      <p>The server did not return an active Component 3 role for this account. No data is shown.</p></div>}
  </div>;
}
