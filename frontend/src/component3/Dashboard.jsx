import { useEffect, useState } from 'react';
import { fetchAuthorizedPharmacies, fetchComponent3Dashboard } from './api.js';
import { getSupabasePublicConfig, refreshSupabaseSession, revokeSupabaseSession, signInWithSupabase } from './supabaseAuth.js';
import { createPharmacyWalletSession } from './walletSession.js';
import './dashboard.css';

const INDICATORS = [
  ['delivery', 'Delivery Reliability', '35%'],
  ['recall', 'Recall Response', '30%'],
  ['complaint', 'Complaint-Handling Performance', '20%'],
  ['inspection', 'Inspection Performance', '15%'],
];
const DEMO_CODE = 'C3-DEMO-PHARMACY-001';

function TextList({ items }) {
  if (!Array.isArray(items) || items.length === 0) return <p className="c3-muted">None reported.</p>;
  const uniqueItems = [...new Set(items.map(item =>
    typeof item === 'string' ? item : item?.message || item?.reason || JSON.stringify(item),
  ))];
  return <ul className="c3-list">{uniqueItems.map(item => <li key={item}>{item}</li>)}</ul>;
}

function evidenceCountLabel(count) {
  const value = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${value} evidence ${value === 1 ? 'item' : 'items'}`;
}

function errorCategory(error) {
  if (error?.status === 401) return 'session';
  if (error?.status === 403) return 'authorization';
  if (error?.status === 404) return 'empty';
  if (error?.status >= 500) return 'server';
  return 'request';
}

export default function Dashboard() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null);
  const [walletSession, setWalletSession] = useState(null);
  const [pharmacies, setPharmacies] = useState([]);
  const [requiresWalletVerification, setRequiresWalletVerification] = useState(false);
  const [pharmacyCode, setPharmacyCode] = useState('');
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState('request');

  useEffect(() => {
    if (!session) return undefined;
    const delay = Math.max(0, session.expiresAt - Date.now() - 60000);
    const timer = setTimeout(async () => {
      try {
        const fresh = await refreshSupabaseSession(session, { config: getSupabasePublicConfig() });
        setSession(fresh);
      } catch {
        setSession(null);
        clearWorkspace();
        setMode('login');
        setError('Your sign-in session expired. Sign in again to continue.');
        setErrorKind('session');
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [session]);

  function clearWorkspace() {
    setPharmacies([]);
    setPharmacyCode('');
    setBundle(null);
    setWalletSession(null);
    setRequiresWalletVerification(false);
  }

  async function loadDirectory(activeSession, activeWallet = walletSession) {
    const config = getSupabasePublicConfig();
    const freshSession = await refreshSupabaseSession(activeSession, { config });
    setSession(freshSession);
    const directory = await fetchAuthorizedPharmacies({
      accessToken: freshSession.accessToken,
      walletToken: activeWallet?.token,
    });
    setPharmacies(directory.pharmacies);
    setRequiresWalletVerification(directory.requiresWalletVerification);
    setPharmacyCode(current => directory.pharmacies.some(item => item.pharmacyCode === current)
      ? current : directory.pharmacies[0]?.pharmacyCode || '');
    setBundle(null);
    return directory;
  }

  async function handleSignIn(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    clearWorkspace();
    let authenticatedSession = null;
    try {
      const config = getSupabasePublicConfig();
      authenticatedSession = await signInWithSupabase({ email, password, config });
      setSession(authenticatedSession);
      setPassword('');
      setMode('live');
      await loadDirectory(authenticatedSession, null);
    } catch (requestError) {
      setSession(authenticatedSession);
      if (authenticatedSession) setMode('live');
      setError(requestError.message || 'Sign-in could not be completed.');
      setErrorKind(requestError.status === 401 ? 'authorization' : 'request');
    } finally {
      setLoading(false);
    }
  }

  async function handleWalletVerification() {
    setWalletLoading(true);
    setError('');
    setErrorKind('request');
    try {
      const freshSession = await refreshSupabaseSession(session, { config: getSupabasePublicConfig() });
      setSession(freshSession);
      const verifiedWallet = await createPharmacyWalletSession();
      setWalletSession(verifiedWallet);
      await loadDirectory(freshSession, verifiedWallet);
      setMode('live');
    } catch (requestError) {
      setError(requestError.message || 'Wallet verification could not be completed.');
      setErrorKind(errorCategory(requestError));
    } finally {
      setWalletLoading(false);
    }
  }

  async function handleLogout() {
    const current = session;
    setSession(null);
    setEmail('');
    setPassword('');
    clearWorkspace();
    setError('');
    setMode('login');
    if (current) await revokeSupabaseSession(current, { config: getSupabasePublicConfig() }).catch(() => {});
  }

  function enterDemo() {
    clearWorkspace();
    setError('');
    setErrorKind('request');
    setMode('demo');
    setPharmacyCode(DEMO_CODE);
  }

  async function loadDashboard(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setErrorKind('request');
    setBundle(null);
    try {
      let accessToken;
      if (mode === 'live') {
        const selected = pharmacies.find(item => item.pharmacyCode === pharmacyCode);
        if (!selected || !selected.permissions.includes('ASSESSMENT_READ')) {
          throw Object.assign(new Error('This account has no assessment permission for the selected pharmacy.'), { status: 403 });
        }
        const freshSession = await refreshSupabaseSession(session, { config: getSupabasePublicConfig() });
        setSession(freshSession);
        accessToken = freshSession.accessToken;
      }
      const result = await fetchComponent3Dashboard({
        pharmacyCode,
        mode,
        accessToken,
        walletToken: walletSession?.token,
      });
      setBundle({ ...result, permissions: mode === 'live'
        ? pharmacies.find(item => item.pharmacyCode === pharmacyCode)?.permissions || []
        : ['ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ'] });
    } catch (requestError) {
      setError(requestError.message || 'The assessment could not be loaded.');
      setErrorKind(errorCategory(requestError));
      if (requestError.status === 401 && mode === 'live') {
        setSession(null);
        clearWorkspace();
        setMode('login');
      }
    } finally {
      setLoading(false);
    }
  }

  const assessment = bundle?.assessment;
  const evidence = bundle?.evidence;
  const findings = bundle?.criticalFindings;
  const summaryRows = evidence?.indicatorEvidence || {};
  const assessmentLimitations = assessment?.limitations || [];
  const evidenceLimitations = evidence?.limitations || [];
  const demo = assessment?.demoLabel === 'LOCAL_SYNTHETIC_DEMO';
  const assessable = assessment?.status === 'ASSESSABLE' && Number.isFinite(assessment.score);
  const permissions = bundle?.permissions || [];
  const canReadEvidence = permissions.includes('EVIDENCE_READ');
  const canReadCritical = permissions.includes('CRITICAL_FINDINGS_READ');

  return <main className="c3-shell">
    <header className="c3-header">
      <a className="c3-brand" href="/" aria-label="MediSafe Chain home"><span className="c3-mark">M</span>
        <span>MediSafe Chain<small>PHARMACY TRUST</small></span></a>
      <div className="c3-header-right"><span className="c3-network-dot"/> Component 3 | Research prototype</div>
    </header>

    <div className="c3-content">
      <section className="c3-intro">
        <div><p className="c3-eyebrow">PHARMACY TRUST &amp; VERIFICATION</p>
          <h1>{mode === 'login' ? 'Sign in to Component 3' : 'Trust assessment'}</h1>
          <p className="c3-lede">A transparent view of available indicators, supporting evidence, and separate escalation signals.</p>
        </div>
        {mode !== 'login' && <div className="c3-prototype-tag">Research prototype</div>}
      </section>

      <div className="c3-disclaimer" role="note">
        <strong>Decision support only.</strong> Scores and tier thresholds are research-prototype values, not official NMRA ratings or regulatory determinations.
      </div>

      {mode === 'login' && <section className="c3-card c3-auth-card">
        <p className="c3-eyebrow">SECURE ACCESS</p><h2>Sign in with your account</h2>
        <p className="c3-helper c3-auth-copy">Your Component 3 access is checked by the backend after sign-in. Pharmacy accounts also verify their assigned wallet. Regulatory access requires an active pharmacy-scoped grant.</p>
        <form className="c3-auth-form" onSubmit={handleSignIn}>
          <div className="c3-field"><label htmlFor="c3-email">Email</label><input id="c3-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required disabled={loading}/></div>
          <div className="c3-field"><label htmlFor="c3-password">Password</label><input id="c3-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required disabled={loading}/></div>
          <button className="c3-primary" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="c3-divider"><span>or</span></div>
        <button type="button" className="c3-secondary" onClick={enterDemo} disabled={loading}>Open local synthetic demo</button>
        <p className="c3-helper">Live sign-in requires the public Supabase project URL and anon key in the Vite environment. No privileged key is used in the browser.</p>
      </section>}

      {mode === 'live' && <section className="c3-card c3-search-card">
        <div className="c3-access-heading"><div><p className="c3-eyebrow">AUTHORIZED WORKSPACE</p><h2>Accessible pharmacies</h2></div>
          <button type="button" className="c3-secondary c3-logout" onClick={handleLogout} disabled={loading || walletLoading}>Sign out</button></div>
        {pharmacies.length > 0 ? <form className="c3-directory-form" onSubmit={loadDashboard}>
          <div className="c3-field"><label htmlFor="c3-pharmacy-code">Pharmacy</label>
            <select id="c3-pharmacy-code" value={pharmacyCode} onChange={event => { setPharmacyCode(event.target.value); setBundle(null); setError(''); }} disabled={loading} required>
              {pharmacies.map(item => <option key={item.pharmacyCode} value={item.pharmacyCode}>{item.pharmacyCode} · {item.accessTypes.join(' / ')}</option>)}
            </select>
          </div>
          <button className="c3-primary" type="submit" disabled={loading || !pharmacyCode}>{loading ? 'Loading assessment…' : 'Load assessment'}</button>
          <p className="c3-helper">The list comes from current Component 3 permissions. Assessment, evidence, and critical-finding access are enforced again by the API.</p>
          {requiresWalletVerification && <button type="button" className="c3-secondary c3-retry-access" onClick={handleWalletVerification} disabled={walletLoading || loading}>{walletLoading ? 'Verifying wallet…' : 'Also verify pharmacy wallet'}</button>}
        </form> : <div className="c3-access-empty">
          <strong>{error && session ? 'Component 3 access could not be checked' : requiresWalletVerification ? 'Verify your pharmacy wallet' : 'No Component 3 access is assigned'}</strong>
          <p>{error && session
            ? 'The backend did not confirm your pharmacy permissions. Retry after checking the Component 3 runtime and authorization database setup.'
            : requiresWalletVerification
            ? 'Your account has an active pharmacy membership. Verify the wallet assigned to that pharmacy to continue.'
            : 'This authenticated account has no active pharmacy membership with an approved wallet assignment or active regulatory grant.'}</p>
          {requiresWalletVerification && <button type="button" className="c3-primary" onClick={handleWalletVerification} disabled={walletLoading || loading}>{walletLoading ? 'Verifying wallet…' : 'Verify pharmacy wallet with MetaMask'}</button>}
          {session && error && <button type="button" className="c3-secondary c3-retry-access" onClick={async () => { setLoading(true); setError(''); try { await loadDirectory(session); } catch (retryError) { setError(retryError.message || 'Access could not be checked.'); setErrorKind(errorCategory(retryError)); } finally { setLoading(false); } }} disabled={loading || walletLoading}>Retry access check</button>}
        </div>}
      </section>}

      {mode === 'demo' && <section className="c3-card c3-search-card">
        <div className="c3-access-heading"><div><p className="c3-eyebrow">LOCAL SYNTHETIC SOURCE</p><h2>Choose a demo pharmacy</h2></div>
          <button type="button" className="c3-secondary c3-logout" onClick={() => { clearWorkspace(); setMode('login'); setBundle(null); setError(''); }}>Return to sign in</button></div>
        <form className="c3-directory-form" onSubmit={loadDashboard}>
          <div className="c3-field"><label htmlFor="c3-demo-code">Synthetic pharmacy fixture</label>
            <select id="c3-demo-code" value={pharmacyCode} onChange={event => { setPharmacyCode(event.target.value); setBundle(null); setError(''); }}>
              <option value="C3-DEMO-PHARMACY-001">C3-DEMO-PHARMACY-001 — synthetic example</option>
              <option value="C3-DEMO-PHARMACY-INSUFFICIENT">C3-DEMO-PHARMACY-INSUFFICIENT — not assessable</option>
            </select>
          </div>
          <button className="c3-primary" type="submit" disabled={loading}>{loading ? 'Loading assessment…' : 'Load demo assessment'}</button>
          <p className="c3-helper">Synthetic prototype fixture only. This mode does not sign in a real user or access database records.</p>
        </form>
      </section>}

      {error && <div className={`c3-state ${errorKind === 'empty' ? 'c3-empty' : 'c3-error'}`} role={errorKind === 'empty' ? 'status' : 'alert'}>
        <strong>{errorKind === 'empty' ? 'No assessment found' : errorKind === 'authorization' ? 'Access denied' : errorKind === 'session' ? 'Session expired' : errorKind === 'server' ? 'Component 3 service error' : 'Request unavailable'}</strong>
        <p>{error}</p>
        {errorKind === 'server' && <span>Check the Component 3 runtime, database configuration, and unapplied authorization migration. No demo data was substituted.</span>}
        {errorKind === 'session' && <span>Sign in again to continue.</span>}
        {errorKind === 'authorization' && mode === 'live' && pharmacies.find(item => item.pharmacyCode === pharmacyCode)?.accessTypes.includes('PHARMACY') &&
          <button type="button" className="c3-secondary c3-retry-access" onClick={handleWalletVerification} disabled={walletLoading || loading}>Renew pharmacy wallet session</button>}
      </div>}
      {loading && mode !== 'login' && <div className="c3-state c3-loading" role="status"><span className="c3-spinner"/> Loading assessment, evidence, and critical findings…</div>}
      {!bundle && !loading && !error && mode !== 'login' && mode === 'demo' && <div className="c3-state c3-empty"><strong>Ready to review</strong><p>Choose a synthetic fixture. No result is assumed or generated by this dashboard.</p></div>}

      {bundle && <>
        <section className="c3-summary-grid" aria-label="Assessment summary">
          <article className="c3-score-card">
            <div className="c3-card-heading"><div><p className="c3-eyebrow">OVERALL TRUST SCORE</p><h2>{assessment.pharmacyId}</h2></div></div>
            {assessable ? <div className="c3-score-line"><strong>{Number(assessment.score).toFixed(1)}</strong><span>/ 100</span></div>
              : <><div className="c3-score-na">NOT ASSESSABLE</div><p className="c3-not-assessable-explanation">There is insufficient verified evidence to calculate this assessment.</p></>}
            <div className="c3-score-meta"><span className={`c3-status ${assessable ? 'good' : 'muted'}`}>{assessment.status || 'Unknown status'}</span>
              {assessable && <span>Tier: <strong>{assessment.tier}</strong></span>}</div>
            <div className="c3-source-line"><span>Evidence provenance</span><strong>{assessment.evidenceSource || 'UNKNOWN'}</strong></div>
            {demo && <p className="c3-chain-note">Local synthetic demonstration data; not verified pharmacy records.</p>}
            {assessment.blockchainVerification && <p className="c3-chain-note">Blockchain verification: {assessment.blockchainVerification}</p>}
          </article>
          <article className={`c3-escalation-card ${findings?.required ? 'alert' : ''}`}>
            <p className="c3-eyebrow">SEPARATE REGULATORY SIGNAL</p><h2>Critical findings</h2>
            {!canReadCritical ? <p className="c3-muted">Your current permission does not include critical-finding details.</p> : <>
              {findings?.accessDenied ? <p className="c3-muted">Critical-finding access is not included in this grant.</p> : <>
                <p className="c3-escalation-state">{findings?.required ? 'Escalation required' : 'No critical escalation recorded'}</p>
                {findings?.required && (!Array.isArray(findings.findings) || findings.findings.length === 0) && <p className="c3-muted">The source records an escalation flag but provides no finding details.</p>}
                {Array.isArray(findings?.findings) && findings.findings.length > 0 && <ul className="c3-finding-list">{findings.findings.map((finding, index) => <li key={finding.id || index}>
                  <strong>{finding.description || 'Finding details unavailable'}</strong>{finding.id && <small>Reference: {finding.id}</small>}{finding.source && <small>Source: {finding.source}</small>}
                </li>)}</ul>}
              </>}
            </>}
          </article>
        </section>

        <section className="c3-section">
          <div className="c3-section-title"><div><p className="c3-eyebrow">INDICATOR BREAKDOWN</p><h2>Four research indicators</h2></div><span className="c3-muted">Proposed weights</span></div>
          <div className="c3-indicator-grid">{INDICATORS.map(([key, label, weight]) => {
            const row = assessment.breakdown?.[key] || {};
            const evidenceRow = summaryRows[key] || {};
            const rowAssessable = row.status === 'ASSESSABLE' && Number.isFinite(row.value);
            return <article className="c3-indicator-card" key={key}>
              <div className="c3-indicator-heading"><span className="c3-indicator-icon">{key.slice(0, 1).toUpperCase()}</span><span className="c3-weight">{weight}</span></div>
              <h3>{label}</h3><div className="c3-indicator-score">{rowAssessable ? `${Number(row.value).toFixed(1)}%` : 'Not assessable'}</div>
              <div className="c3-indicator-footer"><span>{row.status || 'NOT_ASSESSABLE'}</span><span>{evidenceCountLabel(evidenceRow.evidenceCount ?? row.evidenceCount ?? 0)}</span></div>
              <div className="c3-provenance">{evidenceRow.provenance || row.source || 'Evidence unavailable'}</div>
              {evidenceRow.reason && <p className="c3-indicator-reason">{evidenceRow.reason}</p>}
            </article>;
          })}</div>
        </section>

        <section className="c3-card c3-evidence-section">
          <div className="c3-section-title"><div><p className="c3-eyebrow">SUPPORTING RECORDS</p><h2>Evidence overview</h2></div>
            <span className={`c3-status ${evidence?.status === 'VALID' ? 'good' : 'muted'}`}>{canReadEvidence ? (evidence?.status || 'Unavailable') : 'Permission not granted'}</span></div>
          {!canReadEvidence || evidence?.accessDenied ? <p className="c3-muted">Your current permission does not include evidence details.</p> : <div className="c3-evidence-list">{INDICATORS.map(([key, label]) => {
            const item = summaryRows[key] || {};
            const ids = Array.isArray(item.evidenceIds) ? item.evidenceIds : [];
            return <div className="c3-evidence-row" key={key}>
              <div><strong>{label}</strong><small>{item.provenance || 'No provenance available'}</small></div>
              <div className="c3-evidence-detail"><span>{evidenceCountLabel(item.evidenceCount ?? 0)}</span>{ids.length > 0 ? <span className="c3-evidence-ids">{ids.join(', ')}</span> : <span className="c3-muted">No linked evidence IDs</span>}</div>
              <p>{item.reason || 'Evidence summary returned by Component 3.'}</p>
            </div>;
          })}</div>}
          {canReadEvidence && evidence?.evidenceValidation?.limitations?.length > 0 && <div className="c3-limitations"><strong>Evidence validation notes</strong><TextList items={evidence.evidenceValidation.limitations}/></div>}
        </section>

        {(assessmentLimitations.length > 0 || evidenceLimitations.length > 0) && <section className="c3-card c3-limitations"><p className="c3-eyebrow">INTERPRETATION NOTES</p><h2>Limitations</h2><TextList items={[...assessmentLimitations, ...evidenceLimitations]}/></section>}
        <footer className="c3-footer">Component 3 research prototype | Scores and thresholds are not official NMRA ratings | Blockchain verification is reported only where the API confirms it was performed.</footer>
      </>}
    </div>
  </main>;
}
