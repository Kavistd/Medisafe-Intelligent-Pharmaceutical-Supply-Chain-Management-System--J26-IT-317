import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress } from "ethers";
import { apiRequest, API_BASE } from "./component4/api.js";
import { fetchDoctorPrescriptions } from "./component4/doctorPrescriptions.js";
import { createWalletRegistry, REGISTRY_ADDRESS } from "./component4/registryClient.js";
import { assertTokenRole, buildChallengeRequest, encodePersonalSignMessage } from "./component4/authFlow.js";
import {
  assertPatientHashMatches,
  assertPrescriptionIssuer,
  assertWalletContext,
  buildIssueArguments,
  submitWalletTransaction,
  transactionErrorMessage,
} from "./component4/walletTransactions.js";
import { getMetaMaskProvider, requestLocalHardhatNetwork } from "./component4/walletProvider.js";
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
    list: <><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>,
    copy: <><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></>,
    lock: <><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
    ban: <><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10"/></>,
    arrowLeft: <><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></>,
    check: <><path d="M20 6 9 17l-5-5"/></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></>,
    key: <><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 3-9.5 9.5"/><path d="m15.5 7.5 3 3"/><path d="m18 5 2 2"/></>,
    user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    idCard: <><rect width="20" height="14" x="2" y="5" rx="2"/><circle cx="7" cy="12" r="2"/><path d="M13 10h5M13 14h3"/></>,
    calendar: <><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></>,
    file: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/></>,
    sparkles: <><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || null}</svg>;
}

function copyToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text) {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "absolute";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(el);
    return successful;
  } catch (e) {
    return false;
  }
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
  const [walletAvailable, setWalletAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    let provider;
    const onAccountsChanged = (accounts) => {
      setAddress(accounts?.[0] || ""); setChallenge("");
      setError(accounts?.length ? "Wallet account changed. Request a new challenge for this account." : "Wallet disconnected.");
    };
    const onChainChanged = () => { setChallenge(""); setError("Wallet network changed. Request a new challenge to continue."); };
    getMetaMaskProvider().then((selected) => {
      if (!mounted) return;
      provider = selected;
      setWalletAvailable(true);
      selected.on?.("accountsChanged", onAccountsChanged);
      selected.on?.("chainChanged", onChainChanged);
    }).catch(() => { if (mounted) setWalletAvailable(false); });
    return () => {
      mounted = false;
      provider?.removeListener?.("accountsChanged", onAccountsChanged);
      provider?.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  async function signIn() {
    setBusy(true); setError(""); setChallenge("");
    try {
      // Resolve again at click time so login never uses a stale injected provider.
      const provider = await getMetaMaskProvider();
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const walletAddress = accounts?.[0];
      if (!walletAddress) throw new Error("MetaMask did not provide a connected account.");
      await requestLocalHardhatNetwork(provider);
      const chainId = await provider.request({ method: "eth_chainId" });
      await assertWalletContext(provider, walletAddress);
      setAddress(walletAddress);
      const challengeBody = buildChallengeRequest(role, walletAddress, patientPrescriptionId);
      const challengeResult = await apiRequest("/api/v1/prescriptions/auth/challenge", { method: "POST", body: challengeBody });
      const message = challengeResult.data.message;
      setChallenge(message);
      let signature;
      const signableMessage = encodePersonalSignMessage(message);
      try { signature = await provider.request({ method: "personal_sign", params: [signableMessage, walletAddress] }); }
      catch (err) {
        if (err.code === 4001) throw new Error("Signature request was rejected in MetaMask.");
        throw new Error(err.message || "MetaMask could not sign the challenge.");
      }
      const current = await provider.request({ method: "eth_accounts" });
      if (!current?.[0] || current[0].toLowerCase() !== walletAddress.toLowerCase()) throw new Error("Wallet account changed during signing. Please try again.");
      const currentChainId = await provider.request({ method: "eth_chainId" });
      if (currentChainId.toLowerCase() !== chainId.toLowerCase()) throw new Error("Wallet network changed during signing. Please try again.");
      const result = await apiRequest("/api/v1/prescriptions/auth/token", { method: "POST", body: { message, signature } });
      const finalAccounts = await provider.request({ method: "eth_accounts" });
      if (!finalAccounts?.[0] || finalAccounts[0].toLowerCase() !== walletAddress.toLowerCase()) throw new Error("Wallet account changed during sign-in. Please try again.");
      const finalChainId = await provider.request({ method: "eth_chainId" });
      if (finalChainId.toLowerCase() !== chainId.toLowerCase()) throw new Error("Wallet network changed during sign-in. Please try again.");
      const claims = JSON.parse(window.atob(result.data.token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
      assertTokenRole(claims, role, challengeBody.prescriptionId || null);
      onLogin({ token: result.data.token, role, address: walletAddress, prescriptionId: challengeBody.prescriptionId || null, walletProvider: provider });
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
        {role === "patient" && <div className="field-block patient-scope-field"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><label htmlFor="patient-scope-id">Prescription ID for verification</label>{typeof window !== "undefined" && window.sessionStorage?.getItem("lastIssuedPrescriptionId") && <button type="button" style={{ fontSize: "12px", color: "#087D66", fontWeight: "bold", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setPatientPrescriptionId(window.sessionStorage.getItem("lastIssuedPrescriptionId")); setError(""); }}>⚡ Auto-fill last issued Rx</button>}</div><input id="patient-scope-id" className="mono-input" spellCheck="false" autoComplete="off" placeholder="0x followed by 64 hexadecimal characters" value={patientPrescriptionId} onChange={(event) => setPatientPrescriptionId(event.target.value)} pattern="0x[0-9a-fA-F]{64}" required/><span className="field-help">The signed session will be limited to this prescription only.</span></div>}
        <div className="role-hint"><Icon name="lock" size={15}/><span>{role === "patient" ? "Patient access is signed and scoped to one prescription." : "Access is confirmed against your wallet’s on-chain role."}</span></div>
        <p className="field-help">Connect your wallet to sign a fresh, single-use login challenge.</p>
        <button className="button button-primary full-width" disabled={busy || !walletAvailable} onClick={signIn}>{busy ? <><span className="spinner"/> {challenge ? "Verifying wallet…" : "Connecting wallet…"}</> : <>Connect &amp; sign with MetaMask <Icon name="arrow" size={16}/></>}</button>
        {!walletAvailable && <div className="inline-error" role="status">MetaMask was not detected. Install or enable it, then reload this page.</div>}
        {message && <div className="inline-error" role="status">{message}</div>}
        {challenge && <details className="challenge-details"><summary>Challenge details</summary><pre>{challenge}</pre></details>}
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="privacy-callout"><Icon name="lock" size={17}/><span>Your session token stays in memory and is cleared when you sign out or close this page.</span></div>
        <div className="patient-prep-link-box">
          <div className="prep-link-text">
            <strong>Need a patient credential?</strong>
            <span>Generate your local private key file &amp; hash</span>
          </div>
          <button className="button button-secondary prep-btn" type="button" onClick={onPrepare}>
            Prepare credential <Icon name="arrow" size={14}/>
          </button>
        </div>
        <div className="api-foot">API <code>{API_BASE || "same-origin /api (Vite proxy → localhost:5004)"}</code></div>
      </div>
    </section>
  </main>;
}

function Dashboard({ session, onLogout, onSessionExpired }) {
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
  const [doctorPrescriptionList, setDoctorPrescriptionList] = useState(null);
  const [doctorPrescriptionListLoading, setDoctorPrescriptionListLoading] = useState(false);
  const [doctorPrescriptionListError, setDoctorPrescriptionListError] = useState("");
  const [doctorPrescriptionListRetry, setDoctorPrescriptionListRetry] = useState(0);
  const doctorPrescriptionListRequest = useRef(null);

  const doctorNav = [
    { id: "issue", label: "Issue prescription", icon: "plus" },
    { id: "mine", label: "My prescriptions", icon: "list" },
    { id: "lookup", label: "Prescription lookup", icon: "search" },
  ];

  useEffect(() => {
    if (session.role !== "doctor") return undefined;
    let active = true;
    const token = session.token;
    let request = doctorPrescriptionListRequest.current;
    if (!request || request.token !== token) {
      setDoctorPrescriptionList(null);
      setDoctorPrescriptionListLoading(true);
      setDoctorPrescriptionListError("");
      request = { token, promise: fetchDoctorPrescriptions(token) };
      doctorPrescriptionListRequest.current = request;
    } else {
      setDoctorPrescriptionListLoading(true);
    }

    request.promise.then((data) => {
      if (active) setDoctorPrescriptionList(data);
    }).catch((error) => {
      if (!active) return;
      if (error?.status === 401) {
        onSessionExpired();
        return;
      }
      setDoctorPrescriptionListError(error?.message || "Could not load your prescriptions.");
    }).finally(() => {
      if (active) setDoctorPrescriptionListLoading(false);
    });

    return () => { active = false; };
  }, [session.role, session.token, doctorPrescriptionListRetry, onSessionExpired]);

  function retryDoctorPrescriptionList() {
    doctorPrescriptionListRequest.current = null;
    setDoctorPrescriptionListError("");
    setDoctorPrescriptionListRetry((retry) => retry + 1);
  }

  async function submitIssue(event) {
    event.preventDefault(); setBusy(true); setNotice(null);
    try {
      const args = buildIssueArguments({ doctorAddress: session.address, patientHash: issueForm.patientHash.trim(), medicineId: issueForm.medicineId.trim(), batchId: issueForm.batchId.trim(), expiryDays: Number(issueForm.expiryDays) });
      const result = await submitWalletTransaction({
        ethereum: session.walletProvider,
        expectedAddress: session.address,
        role: "doctor",
        method: "issuePrescription",
        args,
        contractFactory: createWalletRegistry,
        onPending: (hash) => setNotice({ type: "pending", message: `Transaction ${hash} submitted. Waiting for confirmation…` }),
      });
      try {
        sessionStorage.setItem("lastIssuedPrescriptionId", args[0]);
        sessionStorage.setItem("lastIssuedPatientHash", (issueForm.patientHash || "").trim());
      } catch (_) {}
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
        ethereum: session.walletProvider,
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
      if (dispenseForm.credentialFile?.name?.toLowerCase()?.includes("patient-preparation")) {
        throw new Error("Wrong file selected! You uploaded '" + dispenseForm.credentialFile.name + "' (the preparation file from Step 1). Please upload 'medisafe-pharmacy-presentation.json' (the pharmacy file from Step 3).");
      }
      const serialized = await readCredentialFile(dispenseForm.credentialFile);
      let credential;
      try {
        credential = await decryptPatientCredential(serialized, dispenseForm.passphrase);
      } catch (decErr) {
        throw new Error("Could not decrypt with passphrase '" + dispenseForm.passphrase + "'. Make sure you selected 'medisafe-pharmacy-presentation.json' (from Step 3) and used the Pharmacy presentation passphrase (PharmacyPass123!).");
      }
      const patientHash = assertPresentationScope(credential, {
        prescriptionId: credential.prescriptionId,
        chainId: 31337,
        registryAddress: REGISTRY_ADDRESS,
        pharmacyAddress: session.address,
      });
      const prescriptionId = credential.prescriptionId;
      const result = await submitWalletTransaction({
        ethereum: session.walletProvider,
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
      setNotice({ type: "success", message: `Prescription dispensed by ${session.address}. Status updated: ACTIVE → USED (Confirmed in block ${result.blockNumber}, Tx: ${result.transactionHash?.slice(0, 10)}…).` });
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
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><strong>{session.role === "doctor" ? (tab === "issue" ? "Issue prescription" : tab === "mine" ? "My prescriptions" : "Prescription lookup") : "Pharmacy desk"}</strong></div><div className="topbar-right"><span className="secure-label"><span className="status-dot"/> Secure session</span><button className="mobile-signout" onClick={onLogout}><Icon name="logout" size={16}/> Sign out</button></div></header>
      <div className="content-wrap">
        <Notice notice={notice} onClose={() => setNotice(null)}/>
        {session.role === "doctor" && tab === "issue" && <>
          <section className="page-heading"><div><span className="eyebrow">DOCTOR WORKSPACE</span><h1>Issue a prescription</h1><p>Create an on-chain prescription using a patient hash prepared through your approved privacy workflow.</p></div><div className="heading-icon"><Icon name="plus" size={23}/></div></section>
          <div className="content-grid">
            <section className="panel issue-panel"><div className="panel-head"><div><h2>Prescription details</h2><p>Fields marked <span className="required-star">*</span> are required</p></div><span className="panel-index">01</span></div>
              <form onSubmit={submitIssue} className="form-stack dashboard-form">
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  <button type="button" className="button button-secondary" style={{ fontSize: "12px", padding: "4px 10px" }} onClick={() => setIssueForm(prev => ({ ...prev, medicineId: "MED-AUGMENTIN-625", batchId: "BATCH-VIVA-001", expiryDays: 30 }))}>
                    ⚡ Auto-fill medicine &amp; safe batch
                  </button>
                </div>
                <div className="field-block"><label htmlFor="patient-hash">Patient privacy hash <span className="required-star">*</span></label><input id="patient-hash" className="mono-input" spellCheck="false" autoComplete="off" placeholder="0x followed by 64 hexadecimal characters" value={issueForm.patientHash} onChange={(e) => setIssueForm({ ...issueForm, patientHash: e.target.value })} pattern="0x[0-9a-fA-F]{64}" title="Enter a 0x-prefixed 32-byte hash" required/><span className="field-help">Use the hash provided by the patient. Never ask them to provide identity data or salt. The hash is public once issued on this registry.</span></div>
                <div className="field-row"><div className="field-block"><label htmlFor="medicine-id">Medicine ID <span className="required-star">*</span></label><input id="medicine-id" placeholder="e.g. MED-AMOX-500" pattern="[A-Za-z0-9_-]{2,50}" value={issueForm.medicineId} onChange={(e) => setIssueForm({ ...issueForm, medicineId: e.target.value })} required/><span className="field-help">Letters, numbers, hyphens, underscores.</span></div><div className="field-block"><label htmlFor="batch-id">Batch ID <span className="required-star">*</span></label><input id="batch-id" placeholder="e.g. BATCH-2026-01" pattern="[A-Za-z0-9_-]{2,50}" value={issueForm.batchId} onChange={(e) => setIssueForm({ ...issueForm, batchId: e.target.value })} required/><span className="field-help">Use the exact registered batch ID.</span></div></div>
                <div className="field-block expiry-field"><label htmlFor="expiry-days">Valid for</label><div className="input-suffix"><input id="expiry-days" type="number" min="1" max="365" value={issueForm.expiryDays} onChange={(e) => setIssueForm({ ...issueForm, expiryDays: e.target.value })} required/><span>days</span></div></div>
                <div className="form-footer"><span className="form-footnote"><Icon name="lock" size={15}/> MetaMask submits the transaction as your doctor wallet.</span><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> {notice?.type === "pending" ? "Waiting for confirmation…" : "Check MetaMask…"}</> : <>Issue prescription <Icon name="arrow" size={16}/></>}</button></div>
              </form>
            </section>
            <aside className="side-info"><div className="info-card privacy-card"><span className="info-icon"><Icon name="shield"/></span><h3>Patient data stays off-chain</h3><p>The doctor dashboard handles only a patient hash, but the current registry makes that hash public.</p></div><div className="info-card steps-card"><h3>Before you issue</h3><ul><li><span>1</span><p>Ask the patient to prepare a hash and encrypted patient credential.</p></li><li><span>2</span><p>Confirm medicine and batch identifiers are correct.</p></li><li><span>3</span><p>Issue using only the patient's hash; never request identity data or salt.</p></li></ul></div></aside>
          </div>
        </>}
        {session.role === "doctor" && tab === "mine" && <>
          <section className="page-heading"><div><span className="eyebrow">DOCTOR WORKSPACE</span><h1>My prescriptions</h1><p>Prescription IDs associated with your authenticated doctor wallet.</p></div><div className="heading-icon"><Icon name="list" size={22}/></div></section>
          <section className="panel lookup-panel" aria-labelledby="doctor-prescriptions-heading">
            <div className="panel-head"><div><h2 id="doctor-prescriptions-heading">Your prescription list</h2><p>{doctorPrescriptionList ? `${doctorPrescriptionList.count} prescription${doctorPrescriptionList.count === 1 ? "" : "s"}` : "Loaded for your signed-in doctor session."}</p></div><span className="panel-index">{doctorPrescriptionList ? doctorPrescriptionList.count : "—"}</span></div>
            {doctorPrescriptionListLoading && <p role="status" aria-live="polite">Loading your prescriptions…</p>}
            {!doctorPrescriptionListLoading && doctorPrescriptionListError && <div className="inline-error" role="alert">{doctorPrescriptionListError}<button className="text-button" type="button" onClick={retryDoctorPrescriptionList}>Try again</button></div>}
            {!doctorPrescriptionListLoading && !doctorPrescriptionListError && doctorPrescriptionList?.prescriptionIds.length === 0 && <p className="prescription-list-empty" role="status">No prescriptions are associated with this doctor account yet.</p>}
            {!doctorPrescriptionListLoading && !doctorPrescriptionListError && doctorPrescriptionList?.prescriptionIds.length > 0 && <ul className="prescription-list">{doctorPrescriptionList.prescriptionIds.map((prescriptionId) => <li key={prescriptionId}><code>{prescriptionId}</code><button className="text-button" type="button" onClick={() => { setLookupId(prescriptionId); setLookup(null); setLookupError(""); setTab("lookup"); }}>Open lookup</button></li>)}</ul>}
          </section>
        </>}
        {session.role === "doctor" && tab === "lookup" && <>
          <section className="page-heading"><div><span className="eyebrow">DOCTOR WORKSPACE</span><h1>Prescription lookup</h1><p>Retrieve prescription status using its on-chain identifier.</p></div><div className="heading-icon"><Icon name="search" size={22}/></div></section>
          <section className="panel lookup-panel"><div className="panel-head"><div><h2>Find a prescription</h2><p>Lookup is restricted to authenticated doctor sessions.</p></div></div><form onSubmit={submitLookup} className="lookup-form"><div className="field-block"><label htmlFor="prescription-id">Prescription ID</label><input id="prescription-id" className="mono-input" spellCheck="false" placeholder="0x…" value={lookupId} onChange={(e) => setLookupId(e.target.value)} pattern="0x[0-9a-fA-F]{64}" title="Enter a 0x-prefixed 32-byte ID" required/></div><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> Looking up…</> : <><Icon name="search" size={16}/> Look up</>}</button></form>{lookupError && <div className="inline-error" role="alert">{lookupError}</div>}
            {lookup && <div className="result-card"><div className="result-top"><div><span className="eyebrow">PRESCRIPTION RECORD</span><h3>{lookup.status}</h3></div><span className={`status-pill status-${String(lookup.status).toLowerCase()}`}>{lookup.isExpired ? "EXPIRED" : lookup.status}</span></div><div className="record-grid"><div><span>Prescription ID</span><code>{lookup.prescriptionId}</code></div><div><span>Issued at</span><strong>{new Date(lookup.issuedAt).toLocaleString()}</strong></div><div><span>Expires</span><strong>{new Date(lookup.expiryTime).toLocaleString()}</strong></div><div><span>Current state</span><strong>{lookup.isExpired ? "Expired" : lookup.status}</strong></div></div>{lookup.status === "ACTIVE" && !lookup.isExpired && <form onSubmit={submitRevoke} className="revoke-form"><div className="field-block"><label htmlFor="revoke-reason">Revocation reason</label><input id="revoke-reason" maxLength="500" placeholder="Reason for revoking this prescription" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} required/></div><button className="button button-danger" disabled={busy}>{busy ? <><span className="spinner"/> {notice?.type === "pending" ? "Waiting for confirmation…" : "Check MetaMask…"}</> : <><Icon name="ban" size={16}/> Revoke prescription</>}</button><p className="field-help revoke-help">MetaMask submits this as the issuing doctor. The contract checks the issuer on-chain.</p></form>}</div>}
          </section><div className="subtle-note"><Icon name="lock" size={16}/><span>The API returns status and timestamps only. It does not return patient identity or hash data.</span></div>
        </>}
        {session.role === "pharmacy" && <>
          <section className="page-heading"><div><span className="eyebrow">PHARMACY WORKSPACE</span><h1>Pharmacy desk</h1><p>Check the patient hash and submit the single-use dispensing transaction from your pharmacy wallet.</p></div><div className="heading-icon"><Icon name="shield" size={22}/></div></section>
          <section className="panel pharmacy-panel"><div className="panel-head"><div><h2>Verify and dispense</h2><p>Unlock the patient’s prescription-bound presentation credential locally. Only its hash and prescription ID are used for the wallet transaction.</p></div></div><form onSubmit={submitDispense} className="form-stack" autoComplete="off"><div className="field-block"><label htmlFor="dispense-credential">Encrypted patient presentation file</label><input ref={dispenseFileInput} id="dispense-credential" type="file" accept="application/json,.json" onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file && file.name.toLowerCase().includes("patient-preparation")) {
                    setNotice({ type: "error", message: "⚠️ WRONG FILE SELECTED: You selected '" + file.name + "'. In the Pharmacy Desk, you must upload 'medisafe-pharmacy-presentation.json' (downloaded in Step 3)." });
                  } else {
                    setNotice(null);
                  }
                  setDispenseForm({ ...dispenseForm, credentialFile: file });
                }} required/><span className="field-help">The file is decrypted in this browser and is not uploaded to the API.</span></div><div className="field-block"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><label htmlFor="dispense-passphrase">Credential passphrase</label><button type="button" style={{ fontSize: "11px", color: "#087D66", fontWeight: "bold", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }} onClick={() => setDispenseForm(f => ({ ...f, passphrase: "PharmacyPass123!" }))}>⚡ Auto-fill demo passphrase</button></div><input id="dispense-passphrase" type="password" autoComplete="off" value={dispenseForm.passphrase} onChange={(e) => setDispenseForm({ ...dispenseForm, passphrase: e.target.value })} required/></div><button className="button button-primary" disabled={busy}>{busy ? <><span className="spinner"/> {notice?.type === "pending" ? "Waiting for confirmation…" : "Checking wallet…"}</> : <>Verify &amp; dispense <Icon name="arrow" size={16}/></>}</button></form></section><div className="subtle-note"><Icon name="lock" size={16}/><span>No identity fields or salt are shared with the pharmacy. The current registry still exposes its patient hash publicly and includes it in contract events.</span></div>
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
  const [pharmacyAddress, setPharmacyAddress] = useState("0x7465C8b4C7a9068c440044222539f993bf4537A7");
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
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
              <button type="button" className="button button-secondary" style={{ fontSize: "12px", padding: "4px 10px" }} onClick={() => { setPassphrase("MedisafeSecret2026!"); setPresentationPassphrase("PharmacyPass123!"); setPharmacyAddress("0x7465C8b4C7a9068c440044222539f993bf4537A7"); }}>
                ⚡ Auto-fill demo passphrases &amp; pharmacy
              </button>
            </div>
            <div className="field-block"><label htmlFor="patient-credential-file">Encrypted preparation credential</label><input ref={credentialInput} id="patient-credential-file" type="file" accept="application/json,.json" onChange={(event) => {
                const file = event.target.files?.[0] || null;
                if (file && file.name.toLowerCase().includes("pharmacy-presentation")) {
                  setNotice({ type: "error", message: "⚠️ WRONG FILE SELECTED: You selected '" + file.name + "'. Here you must upload 'medisafe-patient-preparation.json' (from Step 1)." });
                } else {
                  setNotice(null);
                }
                setCredentialFile(file);
              }} required/><span className="field-help">Select the file downloaded when your patient hash was prepared.</span></div>
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
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [hash, setHash] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function prepare(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setHash("");
    setCopied(false);
    try {
      const identity = {
        nationalId: details.nationalId.trim(),
        fullName: details.fullName.trim(),
        dateOfBirth: details.dateOfBirth.trim(),
      };
      const salt = generatePatientSalt();
      const patientHash = hashPatientCredential(identity, salt);
      const encrypted = await encryptPatientCredential(
        { kind: "medisafe-patient-preparation-v1", identity, salt },
        passphrase
      );
      downloadCredential(encrypted, "medisafe-patient-preparation.json");
      setHash(patientHash);
      setDetails({ nationalId: "", fullName: "", dateOfBirth: "" });
      setPassphrase("");
    } catch (failure) {
      setError(failure.message || "Failed to generate patient credential.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyHash() {
    if (!hash) return;
    await copyToClipboard(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleFillSampleData() {
    setDetails({
      nationalId: "200112345678",
      fullName: "John Doe",
      dateOfBirth: "2001-07-21",
    });
    setPassphrase("MedisafeSecret2026!");
    setError("");
  }

  return (
    <main className="login-shell">
      <aside className="login-aside patient-aside">
        <a className="brand brand-light" href="#home">
          <span className="brand-mark"><Icon name="shield" size={21} /></span>
          <span>MEDISAFE<span className="brand-chain">CHAIN</span></span>
        </a>
        <div className="aside-message">
          <span className="eyebrow eyebrow-light">PATIENT SECURITY VAULT</span>
          <h1>Zero-knowledge<br />patient identity.</h1>
          <p>
            Generate your anonymous cryptographic credential completely offline.
            Retain 100% ownership of your medical confidentiality.
          </p>
          <div className="aside-features">
            <div className="aside-feature-item">
              <span className="feature-icon"><Icon name="shield" size={16} /></span>
              <div>
                <strong>100% Client-Side Privacy</strong>
                <p>Identity details and salt are processed in your browser memory and never leave this device.</p>
              </div>
            </div>
            <div className="aside-feature-item">
              <span className="feature-icon"><Icon name="key" size={16} /></span>
              <div>
                <strong>AES-256-GCM Encryption</strong>
                <p>Your credential file is safeguarded with authenticated encryption using your secret passphrase.</p>
              </div>
            </div>
            <div className="aside-feature-item">
              <span className="feature-icon"><Icon name="lock" size={16} /></span>
              <div>
                <strong>Irreversible Pseudonym</strong>
                <p>Only the cryptographic SHA-256 hash is published on-chain, keeping your real identity concealed.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="aside-foot">
          <span className="status-dot" /> Client cryptographic sandbox active <span>·</span> Zero server retention
        </div>
        <div className="aside-grid" aria-hidden="true" />
      </aside>

      <section className="login-main">
        <div className="login-card patient-prep-card">
          <div className="mobile-brand brand">
            <span className="brand-mark"><Icon name="shield" size={20} /></span>
            <span>MEDISAFE<span className="brand-chain">CHAIN</span></span>
          </div>

          <div className="prep-top-nav">
            <button className="nav-back-button" type="button" onClick={onBack}>
              <Icon name="arrowLeft" size={14} />
              <span>Return to sign in</span>
            </button>
            {!hash && (
              <button
                type="button"
                className="sample-data-btn"
                onClick={handleFillSampleData}
                title="Fill form with sample test data"
              >
                <Icon name="sparkles" size={14} />
                <span>Auto-fill test data</span>
              </button>
            )}
          </div>

          {!hash ? (
            <>
              <div className="page-title-group">
                <span className="eyebrow">PATIENT CONTROLLED</span>
                <h2>Prepare patient credential</h2>
                <p className="muted login-description">
                  Identity and salt are processed in this browser. A fresh random salt is generated and retained only inside the encrypted file.
                </p>
              </div>

              <form onSubmit={prepare} className="form-stack" autoComplete="off">
                <div className="field-block">
                  <label htmlFor="prepare-national-id">
                    <span className="label-with-icon"><Icon name="idCard" size={14} /> National ID / Passport</span>
                  </label>
                  <input
                    id="prepare-national-id"
                    autoComplete="off"
                    placeholder="e.g. 199423405678 or NIC"
                    value={details.nationalId}
                    onChange={(event) => setDetails({ ...details, nationalId: event.target.value })}
                    minLength="5"
                    maxLength="30"
                    required
                  />
                </div>

                <div className="field-block">
                  <label htmlFor="prepare-full-name">
                    <span className="label-with-icon"><Icon name="user" size={14} /> Full legal name</span>
                  </label>
                  <input
                    id="prepare-full-name"
                    autoComplete="off"
                    placeholder="e.g. Jane Alice Doe"
                    value={details.fullName}
                    onChange={(event) => setDetails({ ...details, fullName: event.target.value })}
                    minLength="2"
                    maxLength="100"
                    required
                  />
                </div>

                <div className="field-block">
                  <label htmlFor="prepare-dob">
                    <span className="label-with-icon"><Icon name="calendar" size={14} /> Date of birth</span>
                  </label>
                  <input
                    id="prepare-dob"
                    type="date"
                    autoComplete="off"
                    value={details.dateOfBirth}
                    onChange={(event) => setDetails({ ...details, dateOfBirth: event.target.value })}
                    required
                  />
                </div>

                <div className="field-block">
                  <label htmlFor="prepare-passphrase">
                    <span className="label-with-icon"><Icon name="key" size={14} /> Credential passphrase</span>
                  </label>
                  <div className="input-with-action">
                    <input
                      id="prepare-passphrase"
                      type={showPassphrase ? "text" : "password"}
                      autoComplete="off"
                      placeholder="At least 12 characters"
                      minLength="12"
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="input-action-btn"
                      onClick={() => setShowPassphrase(!showPassphrase)}
                      aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                      tabIndex="-1"
                    >
                      <Icon name={showPassphrase ? "eyeOff" : "eye"} size={16} />
                    </button>
                  </div>
                  <div className="passphrase-meta">
                    <span className={`passphrase-req ${passphrase.length >= 12 ? "valid" : ""}`}>
                      <Icon name={passphrase.length >= 12 ? "check" : "lock"} size={12} />
                      {passphrase.length >= 12 ? "Passphrase length valid" : "Minimum 12 characters required"} ({passphrase.length}/12)
                    </span>
                    <span className="field-help">Use a strong passphrase and keep it separate from the downloaded file.</span>
                  </div>
                </div>

                <button
                  type="submit"
                  className="button button-primary full-width"
                  disabled={busy || passphrase.length < 12}
                >
                  {busy ? (
                    <>
                      <span className="spinner" /> Encrypting locally…
                    </>
                  ) : (
                    <>
                      <Icon name="download" size={16} /> Create &amp; download credential
                    </>
                  )}
                </button>
              </form>

              <div className="privacy-badge-banner">
                <span className="badge-banner-icon"><Icon name="shield" size={18} /></span>
                <div>
                  <strong>Zero-Leakage Assurance</strong>
                  <p>All encryption occurs directly in this browser session. Raw identity data and cryptographic salts are never sent to any server or doctor.</p>
                </div>
              </div>
            </>
          ) : (
            <div className="prep-success-view">
              <div className="success-banner">
                <div className="success-icon-badge"><Icon name="check" size={24} /></div>
                <div>
                  <h3>Credential created successfully!</h3>
                  <p className="file-saved-note">
                    <Icon name="file" size={15} /> <span><strong>medisafe-patient-preparation.json</strong> downloaded.</span>
                  </p>
                </div>
              </div>

              <div className="hash-result-card">
                <div className="hash-card-header">
                  <span className="hash-tag">PUBLIC PATIENT HASH</span>
                  <button type="button" className={`copy-btn ${copied ? "copied" : ""}`} onClick={handleCopyHash}>
                    <Icon name={copied ? "check" : "copy"} size={14} />
                    <span>{copied ? "Copied!" : "Copy hash"}</span>
                  </button>
                </div>
                <code className="hash-code-display">{hash}</code>
                <div className="hash-caption">
                  <Icon name="lock" size={13} />
                  <span>Give only this public hash to your prescribing doctor. The registry will record it.</span>
                </div>
              </div>

              <div className="prep-steps-card">
                <div className="steps-card-title">Important next steps:</div>
                <div className="step-row">
                  <span className="step-badge">1</span>
                  <p><strong>Share this hash with your doctor:</strong> The doctor anchors your prescription to this hash on-chain.</p>
                </div>
                <div className="step-row">
                  <span className="step-badge">2</span>
                  <p><strong>Store your JSON file safely:</strong> Keep <code>medisafe-patient-preparation.json</code>. You need it to verify and prepare pharmacy handoff.</p>
                </div>
                <div className="step-row">
                  <span className="step-badge">3</span>
                  <p><strong>Keep your passphrase secret:</strong> Never send your passphrase or raw identity to doctors or pharmacies.</p>
                </div>
              </div>

              <div className="success-actions">
                <button type="button" className="button button-primary full-width" onClick={onBack}>
                  <Icon name="arrowLeft" size={14} /> Return to sign in
                </button>
                <button
                  type="button"
                  className="button button-secondary full-width"
                  onClick={() => { setHash(""); setError(""); }}
                >
                  <Icon name="plus" size={14} /> Prepare another credential
                </button>
              </div>
            </div>
          )}

          {error && <div className="inline-error" role="alert">{error}</div>}
        </div>
      </section>
    </main>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [logoutMessage, setLogoutMessage] = useState("");
  const [preparingPatient, setPreparingPatient] = useState(false);
  const sessionView = useMemo(() => session, [session]);

  useEffect(() => {
    const provider = session?.walletProvider;
    if (!session || !provider?.on) return undefined;
    const clearSession = (message) => { setSession(null); setLogoutMessage(message || ""); };
    const onAccountsChanged = (accounts) => {
      if (!accounts?.[0] || accounts[0].toLowerCase() !== session.address.toLowerCase()) clearSession("Wallet account changed. Sign in again to continue.");
    };
    const onChainChanged = () => clearSession("Wallet network changed. Sign in again on the configured local network.");
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [session]);

  const signOut = useCallback(() => { setSession(null); setLogoutMessage(""); }, []);
  const expireSession = useCallback(() => {
    setSession(null);
    setLogoutMessage("Your doctor session expired. Sign in again to continue.");
  }, []);
  return sessionView
    ? sessionView.role === "patient"
      ? <PatientDashboard session={sessionView} onLogout={signOut}/>
      : <Dashboard session={sessionView} onLogout={signOut} onSessionExpired={expireSession}/>
    : preparingPatient
      ? <PatientPreparation onBack={() => setPreparingPatient(false)}/>
      : <AuthScreen onPrepare={() => setPreparingPatient(true)} onLogin={(nextSession) => { setSession(nextSession); setLogoutMessage(""); }} message={logoutMessage}/>;
}

export default App;
