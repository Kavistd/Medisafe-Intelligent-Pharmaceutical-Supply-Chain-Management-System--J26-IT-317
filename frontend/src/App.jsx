import { useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress } from "ethers";
import { apiRequest, API_BASE } from "./component4/api.js";
import { createWalletRegistry, REGISTRY_ADDRESS } from "./component4/registryClient.js";
import { assertTokenRole, buildChallengeRequest } from "./component4/authFlow.js";
import {
  assertPatientHashMatches,
  assertPrescriptionIssuer,
  assertWalletContext,
  buildIssueArguments,
  submitWalletTransaction,
  transactionErrorMessage,
} from "./component4/walletTransactions.js";
import {
  assertPresentationScope,
  decryptPatientCredential,
  encryptPatientCredential,
  generatePatientSalt,
  hashPatientCredential,
} from "./component4/patientCredential.js";
import "./component4/component4.css";

const EMPTY_FORM = { patientHash: "", medicineId: "", batchId: "", expiryDays: "30" };
const EMPTY_DISPENSE_FORM = { credentialFile: null, passphrase: "" };

function downloadCredential(serialized, filename) {
  const url = URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readCredentialFile(file) {
  if (!file || file.size > 128 * 1024) throw new Error("Choose a valid credential file smaller than 128 KB.");
  return file.text();
}

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

function AuthScreen({ onLogin, onPrepare, message }) {
  const [role, setRole] = useState("doctor");
  const [address, setAddress] = useState("");
  const [patientPrescriptionId, setPatientPrescriptionId] = useState("");
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
      await assertWalletContext(window.ethereum, walletAddress);
      if (walletChainId && chainId.toLowerCase() !== walletChainId.toLowerCase()) throw new Error("Wallet network changed. Please try signing in again.");
      setAddress(walletAddress);
      const challengeBody = buildChallengeRequest(role, walletAddress, patientPrescriptionId);
      const challengeResult = await apiRequest("/api/v1/prescriptions/auth/challenge", { method: "POST", body: challengeBody });
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
      const currentChainId = await window.ethereum.request({ method: "eth_chainId" });
      if (currentChainId.toLowerCase() !== chainId.toLowerCase()) throw new Error("Wallet network changed during signing. Please try again.");
      const result = await apiRequest("/api/v1/prescriptions/auth/token", { method: "POST", body: { message, signature } });
      const claims = JSON.parse(window.atob(result.data.token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
      assertTokenRole(claims, role, challengeBody.prescriptionId || null);
      onLogin({ token: result.data.token, role, address: walletAddress, prescriptionId: challengeBody.prescriptionId || null });
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
          {[{ id: "doctor", label: "Doctor" }, { id: "pharmacy", label: "Pharmacy" }, { id: "patient", label: "Patient" }].map((item) => <button key={item.id} className={role === item.id ? "role-option selected" : "role-option"} onClick={() => { setRole(item.id); setError(""); }} type="button">{item.label}</button>)}
        </div>
        {role === "patient" && <div className="field-block patient-scope-field"><label htmlFor="patient-scope-id">Prescription ID for verification</label><input id="patient-scope-id" className="mono-input" spellCheck="false" autoComplete="off" placeholder="0x followed by 64 hexadecimal characters" value={patientPrescriptionId} onChange={(event) => setPatientPrescriptionId(event.target.value)} pattern="0x[0-9a-fA-F]{64}" required/><span className="field-help">The signed session will be limited to this prescription only.</span></div>}
        <div className="role-hint"><Icon name="lock" size={15}/><span>{role === "patient" ? "Patient access is signed and scoped to one prescription." : "Access is confirmed against your wallet’s on-chain role."}</span></div>
        <p className="field-help">Connect your wallet to sign a fresh, single-use login challenge.</p>
        <button className="button button-primary full-width" disabled={busy || !walletAvailable} onClick={signIn}>{busy ? <><span className="spinner"/> {challenge ? "Verifying wallet…" : "Connecting wallet…"}</> : <>Connect &amp; sign with MetaMask <Icon name="arrow" size={16}/></>}</button>
        {!walletAvailable && <div className="inline-error" role="status">MetaMask was not detected. Install or enable it, then reload this page.</div>}
        {message && <div className="inline-error" role="status">{message}</div>}
        {challenge && <details className="challenge-details"><summary>Challenge details</summary><pre>{challenge}</pre></details>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="privacy-callout"><Icon name="lock" size={17}/><span>Your session token stays in memory and is cleared when you sign out or close this page.</span></div>
        <button className="text-button" type="button" onClick={onPrepare}>Prepare a patient credential</button>
        <div className="api-foot">API <code>{API_BASE || "same-origin /api (Vite proxy → localhost:5004)"}</code></div>
      </div>
    </section>
  </main>;
}

function Dashboard({ session, onLogout }) {
  const [tab, setTab] = useState(session.role === "doctor" ? "issue" : "pharmacy");
  const [issueForm, setIssueForm] = useState(EMPTY_FORM);
  const [dispenseForm, setDispenseForm] = useState(EMPTY_DISPENSE_FORM);
  const dispenseFileInput = useRef(null);
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
      const args = buildIssueArguments({ doctorAddress: session.address, patientHash: issueForm.patientHash.trim(), medicineId: issueForm.medicineId.trim(), batchId: issueForm.batchId.trim(), expiryDays: Number(issueForm.expiryDays) });
      const result = await submitWalletTransaction({
        ethereum: window.ethereum,
        expectedAddress: session.address,
        role: "doctor",
        method: "issuePrescription",
        args,
        contractFactory: createWalletRegistry,
        onPending: (hash) => setNotice({ type: "pending", message: `Transaction ${hash} submitted. Waiting for confirmation…` }),
      });
      setIssueForm(EMPTY_FORM);
      setNotice({ type: "success", message: `Prescription issued by ${session.address}. ID: ${args[0]}. Confirmed in block ${result.blockNumber}.` });
    } catch (err) { setNotice({ type: "error", message: transactionErrorMessage(err) }); }
    finally { setBusy(false); }
  }

  async function submitLookup(event) {
    event.preventDefault(); setBusy(true); setLookup(null); setLookupError(""); setNotice(null);
    try {
      const result = await apiRequest("/api/v1/prescriptions/lookup", { token: session.token, method: "POST", body: { prescriptionId: lookupId.trim() } });
      setLookup(result.data);
    } catch (err) { setLookupError(err.message); }
    finally { setBusy(false); }
  }

  async function submitRevoke(event) {
    event.preventDefault(); if (!lookup) return; setBusy(true); setNotice(null);
    try {
      const result = await submitWalletTransaction({
        ethereum: window.ethereum,
        expectedAddress: session.address,
        role: "doctor",
        method: "revokePrescription",
        args: [lookup.prescriptionId, revokeReason.trim()],
        contractFactory: createWalletRegistry,
        preflight: async (contract, address) => assertPrescriptionIssuer(await contract.getPrescription(lookup.prescriptionId), address),
        onPending: (hash) => setNotice({ type: "pending", message: `Revocation ${hash} submitted. Waiting for confirmation…` }),
      });
      setNotice({ type: "success", message: `Revocation confirmed in block ${result.blockNumber}.` });
      setRevokeReason(""); setLookup(null);
    } catch (err) { setNotice({ type: "error", message: transactionErrorMessage(err) }); }
    finally { setBusy(false); }
  }

  async function submitDispense(event) {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      const serialized = await readCredentialFile(dispenseForm.credentialFile);
      const credential = await decryptPatientCredential(serialized, dispenseForm.passphrase);
      const patientHash = assertPresentationScope(credential, {
        prescriptionId: credential.prescriptionId,
        chainId: 31337,
        registryAddress: REGISTRY_ADDRESS,
        pharmacyAddress: session.address,
      });
      const prescriptionId = credential.prescriptionId;
      const result = await submitWalletTransaction({
        ethereum: window.ethereum,
        expectedAddress: session.address,
        role: "pharmacy",
        method: "verifyAndDispenseWithPatientHash",
        args: [prescriptionId, patientHash],
        contractFactory: createWalletRegistry,
        preflight: (contract) => assertPatientHashMatches(contract, prescriptionId, patientHash),
        onPending: (hash) => setNotice({ type: "pending", message: `Dispensing transaction ${hash} submitted. Waiting for confirmation…` }),
      });
      setDispenseForm(EMPTY_DISPENSE_FORM);
      if (dispenseFileInput.current) dispenseFileInput.current.value = "";
      setNotice({ type: "success", message: `Prescription dispensed by ${session.address}. Confirmed in block ${result.blockNumber}.` });
    } catch (err) { setNotice({ type: "error", message: transactionErrorMessage(err) }); }
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
                <div className="field-block"><label htmlFor="patient-hash">Patient privacy hash <span className="required-star">*</span></label><input id="patient-hash" className="mono-input" spellCheck="false" autoComplete="off" placeholder="0x followed by 64 hexadecimal characters" value={issueForm.patientHash} onChange={(e) => setIssueForm({ ...issueForm, patientHash: e.target.value })} pattern="0x[0-9a-fA-F]{64}" title="Enter a 0x-prefixed 32-byte hash" required/><span className="field-help">Use the hash provided by the patient. Never ask them to provide identity data or salt. The hash is public once issued on this registry.</span></div>
                <div className="field-row"><div className="field-block"><label htmlFor="medicine-id">Medicine ID <span className="required-star">*</span></label><input id="medicine-id" placeholder="e.g. MED-AMOX-500" pattern="[A-Za-z0-9_-]{2,50}" value={issueForm.medicineId} onChange={(e) => setIssueForm({ ...issueForm, medicineId: e.target.value })} required/><span className="field-help">Letters, numbers, hyphens, underscores.</span></div><div className="field-block"><label htmlFor="batch-id">Batch ID <span className="required-star">*</span></label><input id="batch-id" placeholder="e.g. BATCH-2026-01" pattern="[A-Za-z0-9_-]{2,50}" value={issueForm.batchId} onChange={(e) => setIssueForm({ ...issueForm, batchId: e.target.value })} required/><span className="field-help">Use the exact registered batch ID.</span></div></div>
                <div className="field-block expiry-field"><label htmlFor="expiry-days">Valid for</label><div className="input-suffix"><input id="expiry-days" type="number" min="1" max="365" value={issueForm.expiryDays} onChange={(e) => setIssueForm({ ...issueForm, expiryDays: e.target.value })} required/><span>days</span></div></div>
                <div className="form-footer"><span className="form-footnote"><Icon name="lock" size={15}/> MetaMask submits the transaction as your doctor wallet.</span><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> {notice?.type === "pending" ? "Waiting for confirmation…" : "Check MetaMask…"}</> : <>Issue prescription <Icon name="arrow" size={16}/></>}</button></div>
              </form>
            </section>
            <aside className="side-info"><div className="info-card privacy-card"><span className="info-icon"><Icon name="shield"/></span><h3>Patient data stays off-chain</h3><p>The doctor dashboard handles only a patient hash, but the current registry makes that hash public.</p></div><div className="info-card steps-card"><h3>Before you issue</h3><ul><li><span>1</span><p>Ask the patient to prepare a hash and encrypted patient credential.</p></li><li><span>2</span><p>Confirm medicine and batch identifiers are correct.</p></li><li><span>3</span><p>Issue using only the patient's hash; never request identity data or salt.</p></li></ul></div></aside>
          </div>
        </>}
        {session.role === "doctor" && tab === "lookup" && <>
          <section className="page-heading"><div><span className="eyebrow">DOCTOR WORKSPACE</span><h1>Prescription lookup</h1><p>Retrieve prescription status using its on-chain identifier.</p></div><div className="heading-icon"><Icon name="search" size={22}/></div></section>
          <section className="panel lookup-panel"><div className="panel-head"><div><h2>Find a prescription</h2><p>Lookup is restricted to authenticated doctor sessions.</p></div></div><form onSubmit={submitLookup} className="lookup-form"><div className="field-block"><label htmlFor="prescription-id">Prescription ID</label><input id="prescription-id" className="mono-input" spellCheck="false" placeholder="0x…" value={lookupId} onChange={(e) => setLookupId(e.target.value)} pattern="0x[0-9a-fA-F]{64}" title="Enter a 0x-prefixed 32-byte ID" required/></div><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> Looking up…</> : <><Icon name="search" size={16}/> Look up</>}</button></form>{lookupError && <div className="inline-error" role="alert">{lookupError}</div>}
            {lookup && <div className="result-card"><div className="result-top"><div><span className="eyebrow">PRESCRIPTION RECORD</span><h3>{lookup.status}</h3></div><span className={`status-pill status-${String(lookup.status).toLowerCase()}`}>{lookup.isExpired ? "EXPIRED" : lookup.status}</span></div><div className="record-grid"><div><span>Prescription ID</span><code>{lookup.prescriptionId}</code></div><div><span>Issued at</span><strong>{new Date(lookup.issuedAt).toLocaleString()}</strong></div><div><span>Expires</span><strong>{new Date(lookup.expiryTime).toLocaleString()}</strong></div><div><span>Current state</span><strong>{lookup.isExpired ? "Expired" : lookup.status}</strong></div></div>{lookup.status === "ACTIVE" && !lookup.isExpired && <form onSubmit={submitRevoke} className="revoke-form"><div className="field-block"><label htmlFor="revoke-reason">Revocation reason</label><input id="revoke-reason" maxLength="500" placeholder="Reason for revoking this prescription" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} required/></div><button className="button button-danger" disabled={busy}>{busy ? <><span className="spinner"/> {notice?.type === "pending" ? "Waiting for confirmation…" : "Check MetaMask…"}</> : <><Icon name="ban" size={16}/> Revoke prescription</>}</button><p className="field-help revoke-help">MetaMask submits this as the issuing doctor. The contract checks the issuer on-chain.</p></form>}</div>}
          </section><div className="subtle-note"><Icon name="lock" size={16}/><span>The API returns status and timestamps only. It does not return patient identity or hash data.</span></div>
        </>}
        {session.role === "pharmacy" && <>
          <section className="page-heading"><div><span className="eyebrow">PHARMACY WORKSPACE</span><h1>Pharmacy desk</h1><p>Check the patient hash and submit the single-use dispensing transaction from your pharmacy wallet.</p></div><div className="heading-icon"><Icon name="shield" size={22}/></div></section>
          <section className="panel pharmacy-panel"><div className="panel-head"><div><h2>Verify and dispense</h2><p>Unlock the patient’s prescription-bound presentation credential locally. Only its hash and prescription ID are used for the wallet transaction.</p></div></div><form onSubmit={submitDispense} className="form-stack" autoComplete="off"><div className="field-block"><label htmlFor="dispense-credential">Encrypted patient presentation file</label><input ref={dispenseFileInput} id="dispense-credential" type="file" accept="application/json,.json" onChange={(e) => setDispenseForm({ ...dispenseForm, credentialFile: e.target.files?.[0] || null })} required/><span className="field-help">The file is decrypted in this browser and is not uploaded to the API.</span></div><div className="field-block"><label htmlFor="dispense-passphrase">Credential passphrase</label><input id="dispense-passphrase" type="password" autoComplete="off" value={dispenseForm.passphrase} onChange={(e) => setDispenseForm({ ...dispenseForm, passphrase: e.target.value })} required/></div><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> {notice?.type === "pending" ? "Waiting for confirmation…" : "Checking wallet…"}</> : <>Verify &amp; dispense <Icon name="arrow" size={16}/></>}</button></form></section><div className="subtle-note"><Icon name="lock" size={16}/><span>No identity fields or salt are shared with the pharmacy. The current registry still exposes its patient hash publicly and includes it in contract events.</span></div>
        </>}
        <footer className="page-footer"><span>MEDISAFE CHAIN <i>·</i> Component 4</span><span>Privacy-preserving prescription management</span></footer>
      </div>
    </main>
  </div>;
}

function PatientDashboard({ session, onLogout }) {
  const [credentialFile, setCredentialFile] = useState(null);
  const [passphrase, setPassphrase] = useState("");
  const [presentationPassphrase, setPresentationPassphrase] = useState("");
  const [pharmacyAddress, setPharmacyAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const credentialInput = useRef(null);

  async function verifyCredential(event) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (!isAddress(pharmacyAddress)) throw new Error("Enter the public wallet address of the intended pharmacy.");
      const prepared = await decryptPatientCredential(await readCredentialFile(credentialFile), passphrase);
      if (prepared.kind !== "medisafe-patient-preparation-v1") throw new Error("Choose the patient preparation credential file.");
      const patientHash = hashPatientCredential(prepared.identity, prepared.salt);
      const result = await apiRequest("/api/v1/prescriptions/verify", {
        token: session.token,
        method: "POST",
        body: { prescriptionId: session.prescriptionId, patientHash },
      });
      const presentation = await encryptPatientCredential({
        kind: "medisafe-patient-presentation-v1",
        prescriptionId: result.data.prescriptionId,
        expiryTime: Math.floor(new Date(result.data.expiryTime).getTime() / 1000),
        chainId: 31337,
        registryAddress: REGISTRY_ADDRESS,
        pharmacyAddress: getAddress(pharmacyAddress),
        patientHash,
      }, presentationPassphrase);
      downloadCredential(presentation, "medisafe-pharmacy-presentation.json");
      setNotice({ type: "success", message: "Verification succeeded. Your encrypted pharmacy presentation file was downloaded; keep your preparation credential for your own records." });
      setCredentialFile(null);
      setPassphrase("");
      setPresentationPassphrase("");
      setPharmacyAddress("");
      if (credentialInput.current) credentialInput.current.value = "";
    } catch (error) {
      setNotice({ type: "error", message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#dashboard"><span className="brand-mark"><Icon name="shield" size={20}/></span><span>MEDISAFE<span className="brand-chain">CHAIN</span></span></a>
      <div className="side-label">COMPONENT 04</div><div className="side-section-label">PATIENT ACCESS</div>
      <nav className="side-nav"><span className="nav-item active"><Icon name="lock"/>Prescription verification</span></nav>
      <div className="sidebar-spacer"/><div className="sidebar-note"><Icon name="lock" size={16}/><p>Your signed access is limited to one prescription.</p></div>
      <div className="profile-row"><div className="avatar">PT</div><div className="profile-info"><strong>Patient session</strong><span>{session.address.slice(0, 6)}…{session.address.slice(-4)}</span></div><button className="icon-button logout-button" onClick={onLogout} aria-label="Sign out" title="Sign out"><Icon name="logout"/></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Patient</span><span className="crumb-sep">/</span><strong>Verify identity</strong></div><div className="topbar-right"><button className="mobile-signout" onClick={onLogout}><Icon name="logout" size={16}/> Sign out</button></div></header>
      <div className="content-wrap">
        <Notice notice={notice} onClose={() => setNotice(null)}/>
        <section className="page-heading"><div><span className="eyebrow">PATIENT WORKSPACE</span><h1>Verify your identity</h1><p>This signed session can verify only prescription <code>{session.prescriptionId}</code>.</p></div><div className="heading-icon"><Icon name="lock" size={22}/></div></section>
        <section className="panel patient-verification-panel"><div className="panel-head"><div><h2>Verify patient credential</h2><p>Your encrypted preparation file is decrypted in this browser. The API receives only the 32-byte hash, not your identity or salt.</p></div></div>
          <form onSubmit={verifyCredential} className="form-stack" autoComplete="off">
            <div className="field-block"><label htmlFor="patient-credential-file">Encrypted preparation credential</label><input ref={credentialInput} id="patient-credential-file" type="file" accept="application/json,.json" onChange={(event) => setCredentialFile(event.target.files?.[0] || null)} required/><span className="field-help">Select the file downloaded when your patient hash was prepared.</span></div>
            <div className="field-block"><label htmlFor="patient-credential-passphrase">Credential passphrase</label><input id="patient-credential-passphrase" type="password" autoComplete="off" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required/></div>
            <div className="field-block"><label htmlFor="presentation-passphrase">New pharmacy presentation passphrase</label><input id="presentation-passphrase" type="password" autoComplete="off" minLength="12" value={presentationPassphrase} onChange={(event) => setPresentationPassphrase(event.target.value)} required/><span className="field-help">Choose a different passphrase from your private preparation file. Share it with the intended pharmacy separately.</span></div>
            <div className="field-block"><label htmlFor="intended-pharmacy">Intended pharmacy wallet</label><input id="intended-pharmacy" className="mono-input" spellCheck="false" autoComplete="off" value={pharmacyAddress} onChange={(event) => setPharmacyAddress(event.target.value)} placeholder="0x followed by 40 hexadecimal characters" required/><span className="field-help">The presentation credential will be scoped to this public pharmacy address.</span></div>
            <button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> Verifying…</> : <>Verify and prepare pharmacy handoff <Icon name="arrow" size={16}/></>}</button>
          </form>
        </section>
        <div className="subtle-note"><Icon name="lock" size={16}/><span>Keep the preparation file as your private record. Share only the separately encrypted presentation file and its passphrase through an approved channel. Never share your identity data or salt.</span></div>
        <footer className="page-footer"><span>MEDISAFE CHAIN <i>·</i> Component 4</span><span>Privacy-preserving prescription management</span></footer>
      </div>
    </main>
  </div>;
}

function PatientPreparation({ onBack }) {
  const [details, setDetails] = useState({ nationalId: "", fullName: "", dateOfBirth: "" });
  const [passphrase, setPassphrase] = useState("");
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function prepare(event) {
    event.preventDefault(); setBusy(true); setError(""); setHash("");
    try {
      const identity = { nationalId: details.nationalId, fullName: details.fullName, dateOfBirth: details.dateOfBirth };
      const salt = generatePatientSalt();
      const patientHash = hashPatientCredential(identity, salt);
      const encrypted = await encryptPatientCredential({ kind: "medisafe-patient-preparation-v1", identity, salt }, passphrase);
      downloadCredential(encrypted, "medisafe-patient-preparation.json");
      setHash(patientHash);
      setDetails({ nationalId: "", fullName: "", dateOfBirth: "" });
      setPassphrase("");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <main className="login-shell"><section className="login-main"><div className="login-card">
    <span className="eyebrow">PATIENT CONTROLLED</span><h2>Prepare patient credential</h2>
    <p className="muted login-description">Identity and salt are processed in this browser. A fresh random salt is generated and retained only inside the encrypted file.</p>
    <form onSubmit={prepare} className="form-stack" autoComplete="off">
      <div className="field-block"><label htmlFor="prepare-national-id">National ID</label><input id="prepare-national-id" autoComplete="off" value={details.nationalId} onChange={(event) => setDetails({ ...details, nationalId: event.target.value })} minLength="5" maxLength="30" required/></div>
      <div className="field-block"><label htmlFor="prepare-full-name">Full name</label><input id="prepare-full-name" autoComplete="off" value={details.fullName} onChange={(event) => setDetails({ ...details, fullName: event.target.value })} minLength="2" maxLength="100" required/></div>
      <div className="field-block"><label htmlFor="prepare-dob">Date of birth</label><input id="prepare-dob" type="date" autoComplete="off" value={details.dateOfBirth} onChange={(event) => setDetails({ ...details, dateOfBirth: event.target.value })} required/></div>
      <div className="field-block"><label htmlFor="prepare-passphrase">Credential passphrase</label><input id="prepare-passphrase" type="password" autoComplete="off" minLength="12" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required/><span className="field-help">Use a strong passphrase and keep it separate from the downloaded file.</span></div>
      <button className="button button-primary full-width" disabled={busy}>{busy ? "Encrypting locally…" : "Create encrypted credential"}</button>
    </form>
    {hash && <div className="privacy-callout"><span>Give this hash to the doctor through your approved channel. The registry will make it public.</span><code className="mono-input">{hash}</code><span>Keep the downloaded preparation file and passphrase. Never send identity data or salt to the doctor or pharmacy.</span></div>}
    {error && <div className="inline-error" role="alert">{error}</div>}
    <button className="text-button" type="button" onClick={onBack}>Return to sign in</button>
  </div></section></main>;
}

function App() {
  const [session, setSession] = useState(null);
  const [logoutMessage, setLogoutMessage] = useState("");
  const [preparingPatient, setPreparingPatient] = useState(false);
  const sessionView = useMemo(() => session, [session]);

  useEffect(() => {
    if (!session || !window.ethereum?.on) return undefined;
    const clearSession = (message) => { setSession(null); setLogoutMessage(message || ""); };
    const onAccountsChanged = (accounts) => {
      if (!accounts?.[0] || accounts[0].toLowerCase() !== session.address.toLowerCase()) clearSession("Wallet account changed. Sign in again to continue.");
    };
    const onChainChanged = () => clearSession("Wallet network changed. Sign in again on the configured local network.");
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [session]);

  const signOut = () => { setSession(null); setLogoutMessage(""); };
  return sessionView
    ? sessionView.role === "patient"
      ? <PatientDashboard session={sessionView} onLogout={signOut}/>
      : <Dashboard session={sessionView} onLogout={signOut}/>
    : preparingPatient
      ? <PatientPreparation onBack={() => setPreparingPatient(false)}/>
      : <AuthScreen onPrepare={() => setPreparingPatient(true)} onLogin={(nextSession) => { setSession(nextSession); setLogoutMessage(""); }} message={logoutMessage}/>;
}

export default App;
