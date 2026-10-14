import { useEffect, useMemo, useState } from "react";
import { apiRequest, API_BASE } from "./component4/api.js";
import "./component4/component4.css";

const EMPTY_FORM = { patientHash: "", medicineId: "", batchId: "", expiryDays: "30" };

function Icon({ name, size = 18 }) {
  const paths = {
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>,
    copy: <><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></>,
    lock: <><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    ban: <><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Notice({ notice, onClose }) {
  if (!notice) return null;
  return <div className={`notice notice-${notice.type}`} role="status"><span>{notice.message}</span><button className="notice-close" onClick={onClose} aria-label="Dismiss">×</button></div>;
}

function AuthScreen({ onLogin }) {
  const [role, setRole] = useState("doctor");
  const [address, setAddress] = useState("");
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [walletAvailable, setWalletAvailable] = useState(Boolean(window.ethereum?.request));
  const [walletChainId, setWalletChainId] = useState("");

  useEffect(() => {
    if (!window.ethereum?.on) return undefined;
    const onAccountsChanged = (accounts) => {
      setAddress(accounts?.[0] || ""); setChallenge("");
      setError(accounts?.length ? "Wallet account changed. Request a new challenge for this account." : "Wallet disconnected.");
    };
    const onChainChanged = (chainId) => { setWalletChainId(chainId); setChallenge(""); setError("Wallet network changed. Request a new challenge to continue."); };
    window.ethereum.request({ method: "eth_chainId" }).then(setWalletChainId).catch(() => {});
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => { window.ethereum.removeListener?.("accountsChanged", onAccountsChanged); window.ethereum.removeListener?.("chainChanged", onChainChanged); };
  }, []);

  async function signIn() {
    setBusy(true); setError(""); setChallenge("");
    try {
      if (!window.ethereum?.request) throw new Error("MetaMask was not found. Install or enable the wallet extension and try again.");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const walletAddress = accounts?.[0];
      if (!walletAddress) throw new Error("MetaMask did not provide a connected account.");
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (walletChainId && chainId.toLowerCase() !== walletChainId.toLowerCase()) throw new Error("Wallet network changed. Please try signing in again.");
      setAddress(walletAddress);
      const challengeResult = await apiRequest("/api/v1/prescriptions/auth/challenge", { method: "POST", body: { address: walletAddress } });
      const message = challengeResult.data.message;
      setChallenge(message);
      let signature;
      try { signature = await window.ethereum.request({ method: "personal_sign", params: [message, walletAddress] }); }
      catch (err) {
        if (err.code === 4001) throw new Error("Signature request was rejected in MetaMask.");
        throw new Error(err.message || "MetaMask could not sign the challenge.");
      }
      const current = await window.ethereum.request({ method: "eth_accounts" });
      if (!current?.[0] || current[0].toLowerCase() !== walletAddress.toLowerCase()) throw new Error("Wallet account changed during signing. Please try again.");
      const result = await apiRequest("/api/v1/prescriptions/auth/token", { method: "POST", body: { message, signature } });
      const claims = JSON.parse(window.atob(result.data.token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
      if (!claims.roles?.includes(role)) {
        throw new Error(`This wallet has no on-chain ${role} role in the configured Component 4 contract.`);
      }
      onLogin({ token: result.data.token, role, address: walletAddress });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <main className="login-shell">
    <aside className="login-aside">
      <a className="brand brand-light" href="#home"><span className="brand-mark"><Icon name="shield" size={21}/></span><span>MEDISAFE<span className="brand-chain">CHAIN</span></span></a>
      <div className="aside-message"><span className="eyebrow eyebrow-light">COMPONENT 04</span><h1>Prescriptions,<br/>with privacy<br/>at the center.</h1><p>Secure prescription workflows for verified healthcare professionals.</p></div>
      <div className="aside-foot"><span className="status-dot"/> Private session <span>·</span> Client-side only</div>
      <div className="aside-grid" aria-hidden="true"/>
    </aside>
    <section className="login-main">
      <div className="login-card">
        <div className="mobile-brand brand"><span className="brand-mark"><Icon name="shield" size={20}/></span><span>MEDISAFE<span className="brand-chain">CHAIN</span></span></div>
        <span className="eyebrow">SECURE ACCESS</span>
        <h2>Welcome back</h2>
        <p className="muted login-description">Sign in with your Ethereum wallet to access prescription management.</p>
        <div className="role-picker" aria-label="Choose dashboard">
          {[{ id: "doctor", label: "Doctor" }, { id: "pharmacy", label: "Pharmacy" }].map((item) => <button key={item.id} className={role === item.id ? "role-option selected" : "role-option"} onClick={() => setRole(item.id)} type="button">{item.label}</button>)}
        </div>
        <div className="role-hint"><Icon name="lock" size={15}/><span>Access is confirmed against your wallet’s on-chain role.</span></div>
        <p className="field-help">Connect your wallet to sign a fresh, single-use login challenge.</p>
        <button className="button button-primary full-width" disabled={busy || !walletAvailable} onClick={signIn}>{busy ? <><span className="spinner"/> {challenge ? "Verifying wallet…" : "Connecting wallet…"}</> : <>Connect &amp; sign with MetaMask <Icon name="arrow" size={16}/></>}</button>
        {!walletAvailable && <div className="inline-error" role="status">MetaMask was not detected. Install or enable it, then reload this page.</div>}
        {challenge && <details className="challenge-details"><summary>Challenge details</summary><pre>{challenge}</pre></details>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="privacy-callout"><Icon name="lock" size={17}/><span>Your session token stays in memory and is cleared when you sign out or close this page.</span></div>
        <div className="api-foot">API <code>{API_BASE || "same-origin /api (Vite proxy → localhost:5004)"}</code></div>
      </div>
    </section>
  </main>;
}

function Dashboard({ session, onLogout }) {
  const [tab, setTab] = useState(session.role === "doctor" ? "issue" : "pharmacy");
  const [issueForm, setIssueForm] = useState(EMPTY_FORM);
  const [lookupId, setLookupId] = useState("");
  const [lookup, setLookup] = useState(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [lookupError, setLookupError] = useState("");

  const doctorNav = [
    { id: "issue", label: "Issue prescription", icon: "plus" },
    { id: "lookup", label: "Prescription lookup", icon: "search" },
  ];

  async function submitIssue(event) {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      const result = await apiRequest("/api/v1/prescriptions/issue", { token: session.token, method: "POST", body: { patientHash: issueForm.patientHash.trim(), medicineId: issueForm.medicineId.trim(), batchId: issueForm.batchId.trim(), expiryDays: Number(issueForm.expiryDays) } });
      setIssueForm(EMPTY_FORM);
      setNotice({ type: "success", message: `Prescription issued. ID: ${result.data.prescriptionId}` });
    } catch (err) { setNotice({ type: "error", message: err.message }); }
    finally { setBusy(false); }
  }

  async function submitLookup(event) {
    event.preventDefault(); setBusy(true); setLookup(null); setLookupError(""); setNotice(null);
    try {
      const result = await apiRequest(`/api/v1/prescriptions/${encodeURIComponent(lookupId.trim())}`, { token: session.token });
      setLookup(result.data);
    } catch (err) { setLookupError(err.message); }
    finally { setBusy(false); }
  }

  async function submitRevoke(event) {
    event.preventDefault(); if (!lookup) return; setBusy(true); setNotice(null);
    try {
      await apiRequest(`/api/v1/prescriptions/${encodeURIComponent(lookup.prescriptionId)}/revoke`, { token: session.token, method: "POST", body: { reason: revokeReason.trim() } });
      setNotice({ type: "success", message: "Revocation confirmed by the backend." });
      setRevokeReason(""); setLookup(null);
    } catch (err) { setNotice({ type: "error", message: err.message }); }
    finally { setBusy(false); }
  }

  const roleName = session.role === "doctor" ? "Doctor" : "Pharmacy";
  const shortAddress = `${session.address.slice(0, 6)}…${session.address.slice(-4)}`;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#dashboard"><span className="brand-mark"><Icon name="shield" size={20}/></span><span>MEDISAFE<span className="brand-chain">CHAIN</span></span></a>
      <div className="side-label">COMPONENT 04</div>
      <div className="side-section-label">WORKSPACE</div>
      {session.role === "doctor" ? <nav className="side-nav">{doctorNav.map((item) => <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => { setTab(item.id); setNotice(null); }}><Icon name={item.icon}/>{item.label}</button>)}</nav> : <nav className="side-nav"><button className="nav-item active" type="button"><Icon name="shield"/>Pharmacy desk</button></nav>}
      <div className="sidebar-spacer"/>
      <div className="sidebar-note"><Icon name="lock" size={16}/><p>Patient identity details are never requested in this dashboard.</p></div>
      <div className="profile-row"><div className="avatar">{session.role === "doctor" ? "DR" : "PH"}</div><div className="profile-info"><strong>{roleName} session</strong><span>{shortAddress}</span></div><button className="icon-button logout-button" onClick={onLogout} aria-label="Sign out" title="Sign out"><Icon name="logout"/></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><strong>{session.role === "doctor" ? (tab === "issue" ? "Issue prescription" : "Prescription lookup") : "Pharmacy desk"}</strong></div><div className="topbar-right"><span className="secure-label"><span className="status-dot"/> Secure session</span><button className="mobile-signout" onClick={onLogout}><Icon name="logout" size={16}/> Sign out</button></div></header>
      <div className="content-wrap">
        <Notice notice={notice} onClose={() => setNotice(null)}/>
        {session.role === "doctor" && tab === "issue" && <>
          <section className="page-heading"><div><span className="eyebrow">DOCTOR WORKSPACE</span><h1>Issue a prescription</h1><p>Create an on-chain prescription using a patient hash prepared through your approved privacy workflow.</p></div><div className="heading-icon"><Icon name="plus" size={23}/></div></section>
          <div className="content-grid">
            <section className="panel issue-panel"><div className="panel-head"><div><h2>Prescription details</h2><p>Fields marked <span className="required-star">*</span> are required</p></div><span className="panel-index">01</span></div>
              <form onSubmit={submitIssue} className="form-stack dashboard-form">
                <div className="field-block"><label htmlFor="patient-hash">Patient privacy hash <span className="required-star">*</span></label><input id="patient-hash" className="mono-input" spellCheck="false" autoComplete="off" placeholder="0x followed by 64 hexadecimal characters" value={issueForm.patientHash} onChange={(e) => setIssueForm({ ...issueForm, patientHash: e.target.value })} pattern="0x[0-9a-fA-F]{64}" title="Enter a 0x-prefixed 32-byte hash" required/><span className="field-help">Enter a patient hash generated outside this app. Do not enter a name, national ID, date of birth, or salt.</span></div>
                <div className="field-row"><div className="field-block"><label htmlFor="medicine-id">Medicine ID <span className="required-star">*</span></label><input id="medicine-id" placeholder="e.g. MED-AMOX-500" pattern="[A-Za-z0-9_-]{2,50}" value={issueForm.medicineId} onChange={(e) => setIssueForm({ ...issueForm, medicineId: e.target.value })} required/><span className="field-help">Letters, numbers, hyphens, underscores.</span></div><div className="field-block"><label htmlFor="batch-id">Batch ID <span className="required-star">*</span></label><input id="batch-id" placeholder="e.g. BATCH-2026-01" pattern="[A-Za-z0-9_-]{2,50}" value={issueForm.batchId} onChange={(e) => setIssueForm({ ...issueForm, batchId: e.target.value })} required/><span className="field-help">Use the exact registered batch ID.</span></div></div>
                <div className="field-block expiry-field"><label htmlFor="expiry-days">Valid for</label><div className="input-suffix"><input id="expiry-days" type="number" min="1" max="365" value={issueForm.expiryDays} onChange={(e) => setIssueForm({ ...issueForm, expiryDays: e.target.value })} required/><span>days</span></div></div>
                <div className="form-footer"><span className="form-footnote"><Icon name="lock" size={15}/> No patient identity fields collected</span><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> Issuing…</> : <>Issue prescription <Icon name="arrow" size={16}/></>}</button></div>
              </form>
            </section>
            <aside className="side-info"><div className="info-card privacy-card"><span className="info-icon"><Icon name="shield"/></span><h3>Privacy by design</h3><p>Only the patient hash is sent to the API. Patient identity details and salts are not collected or stored here.</p></div><div className="info-card steps-card"><h3>Before you issue</h3><ul><li><span>1</span><p>Generate or obtain a patient hash through your approved privacy process.</p></li><li><span>2</span><p>Confirm medicine and batch identifiers are correct.</p></li><li><span>3</span><p>Share the prescription ID with the patient through a secure channel.</p></li></ul></div></aside>
          </div>
        </>}
        {session.role === "doctor" && tab === "lookup" && <>
          <section className="page-heading"><div><span className="eyebrow">DOCTOR WORKSPACE</span><h1>Prescription lookup</h1><p>Retrieve prescription status using its on-chain identifier.</p></div><div className="heading-icon"><Icon name="search" size={22}/></div></section>
          <section className="panel lookup-panel"><div className="panel-head"><div><h2>Find a prescription</h2><p>Lookup is restricted to authenticated doctor sessions.</p></div></div><form onSubmit={submitLookup} className="lookup-form"><div className="field-block"><label htmlFor="prescription-id">Prescription ID</label><input id="prescription-id" className="mono-input" spellCheck="false" placeholder="0x…" value={lookupId} onChange={(e) => setLookupId(e.target.value)} pattern="0x[0-9a-fA-F]{64}" title="Enter a 0x-prefixed 32-byte ID" required/></div><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> Looking up…</> : <><Icon name="search" size={16}/> Look up</>}</button></form>{lookupError && <div className="inline-error" role="alert">{lookupError}</div>}
            {lookup && <div className="result-card"><div className="result-top"><div><span className="eyebrow">PRESCRIPTION RECORD</span><h3>{lookup.status}</h3></div><span className={`status-pill status-${String(lookup.status).toLowerCase()}`}>{lookup.isExpired ? "EXPIRED" : lookup.status}</span></div><div className="record-grid"><div><span>Prescription ID</span><code>{lookup.prescriptionId}</code></div><div><span>Issued at</span><strong>{new Date(lookup.issuedAt).toLocaleString()}</strong></div><div><span>Expires</span><strong>{new Date(lookup.expiryTime).toLocaleString()}</strong></div><div><span>Current state</span><strong>{lookup.isExpired ? "Expired" : lookup.status}</strong></div></div>{lookup.status === "ACTIVE" && !lookup.isExpired && <form onSubmit={submitRevoke} className="revoke-form"><div className="field-block"><label htmlFor="revoke-reason">Revocation reason</label><input id="revoke-reason" maxLength="500" placeholder="Reason for revoking this prescription" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} required/></div><button className="button button-danger" disabled={busy}>{busy ? <><span className="spinner"/> Revoking…</> : <><Icon name="ban" size={16}/> Revoke prescription</>}</button><p className="field-help revoke-help">The backend permits revocation only by the issuing doctor.</p></form>}</div>}
          </section><div className="subtle-note"><Icon name="lock" size={16}/><span>The API returns status and timestamps only. It does not return patient identity or hash data.</span></div>
        </>}
        {session.role === "pharmacy" && <>
          <section className="page-heading"><div><span className="eyebrow">PHARMACY WORKSPACE</span><h1>Pharmacy desk</h1><p>Prescription verification and dispensing require additional backend support.</p></div><div className="heading-icon"><Icon name="shield" size={22}/></div></section>
          <section className="pending-panel"><div className="pending-symbol"><Icon name="ban" size={26}/></div><div className="pending-content"><span className="eyebrow">WORKFLOW UNAVAILABLE</span><h2>Verification is not enabled yet</h2><p>The current verification endpoint is patient-scoped, and the dispense endpoint requires the patient’s national ID, full name, date of birth, and salt to be sent to the backend. This dashboard will not collect or transmit those sensitive details.</p><div className="pending-divider"/><h3>Backend support needed</h3><ul><li>A pharmacy-authorized prescription verification endpoint.</li><li>A dispensing flow that verifies patient identity without sending raw identity data to the backend.</li><li>Role-specific transaction signing for the dispensing pharmacy.</li></ul><button className="button button-disabled" type="button" disabled><Icon name="lock" size={16}/> Verification &amp; dispensing pending</button></div></section>
        </>}
        <footer className="page-footer"><span>MEDISAFE CHAIN <i>·</i> Component 4</span><span>Privacy-preserving prescription management</span></footer>
      </div>
    </main>
  </div>;
}

function App() {
  const [session, setSession] = useState(null);
  const sessionView = useMemo(() => session, [session]);
  return sessionView ? <Dashboard session={sessionView} onLogout={() => setSession(null)}/> : <AuthScreen onLogin={setSession}/>;
}

export default App;
