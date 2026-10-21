import { useEffect, useRef, useState } from 'react';
import { api, batchPath, connectWallet, dashboardBatches, transferTarget, selectWalletProvider, watchWallet, discover, documentRequest, loadBatch, registration, sendPrepared, settings, networkName, STAGES } from './client.js';
import './traceability.css';

const config = settings();
const fields = { batchId: 'Batch ID', medicineId: 'Medicine ID', name: 'Medicine name', category: 'Category', dosageForm: 'Dosage form', strength: 'Strength', manufacturerName: 'Manufacturer name', indication: 'Indication', classification: 'Classification', quantity: 'Batch quantity', manufacturedAt: 'Manufactured at', expiresAt: 'Expires at', certificateReference: 'Certificate CID or ipfs:// reference', documentReference: 'Laboratory report CID or ipfs:// reference' };
const emptyForm = Object.fromEntries(Object.keys(fields).map(key => [key, '']));
const same = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const date = value => { const parsed = new Date(Number(value) * 1000); return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleString(); };
const short = value => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : 'Not connected';
const safeMessage = error => error?.code === 4001 || error?.code === 'ACTION_REJECTED' ? 'Wallet request declined. No transaction was submitted.' : error?.shortMessage || error?.message || 'Request failed. Please try again.';

export default function TraceabilityApp() {
  const [tab, setTab] = useState('tracking'), [session, setSession] = useState(null), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null), [query, setQuery] = useState(''), [record, setRecord] = useState(null);
  const [form, setForm] = useState(emptyForm), [recipient, setRecipient] = useState('');
  const [rows, setRows] = useState([]), [nextBlock, setNextBlock] = useState(config.startBlock), [scanned, setScanned] = useState(null);
  const [approved, setApproved] = useState(false), [files, setFiles] = useState({});
  const generation = useRef(0), transferSection = useRef(null);
  const [ethereum, setEthereum] = useState(null);
  useEffect(() => {
    const clear = () => { generation.current++; setSession(null); setRows([]); setNextBlock(config.startBlock); setScanned(null); setNotice({ kind: 'info', text: 'Wallet account or network changed. Reconnect to continue.' }); };
    return watchWallet(ethereum, clear);
  }, [ethereum]);
  async function run(action) {
    setBusy(true); setNotice(null);
    try { await action(); } catch (error) { setNotice({ kind: 'error', text: safeMessage(error) }); }
    finally { setBusy(false); }
  }
  async function connect() {
    setSession(null);
    const version = ++generation.current;
    const selected = await selectWalletProvider({ target: window });
    setEthereum(selected);
    const connected = await connectWallet(selected, config);
    if (version !== generation.current) throw new Error('Wallet changed while connecting. Retry.');
    setSession(connected); setRows([]); setNextBlock(config.startBlock); setScanned(null);
    setNotice({ kind: 'success', text: 'Wallet connected. On-chain permissions verified.' });
  }
  async function track(batchId) {
    setRecord(null); const result = await loadBatch(batchId); setRecord(result); setQuery(batchId);
    setRows(previous => [...new Map([...previous, result].map(row => [row.data.batchId, row])).values()]);
  }
  async function scan(start = nextBlock, reset = false) {
    const version = generation.current, currentSession = session;
    const head = await currentSession.provider.getBlockNumber();
    if (start > head) { setNotice({ kind: 'info', text: 'You have scanned through the current block. Restart the scan to refresh earlier activity.' }); return; }
    const result = await discover(currentSession, start, head);
    const loaded = [];
    for (const id of result.ids) loaded.push(await loadBatch(id));
    if (version !== generation.current) return;
    setRows(previous => [...new Map([...(reset ? [] : previous), ...loaded].map(row => [row.data.batchId, row])).values()]);
    setNextBlock(result.nextBlock); setScanned(`${start.toLocaleString()}–${(result.nextBlock - 1).toLocaleString()} of ${head.toLocaleString()}`);
  }
  async function transact(action, method, args, body, id = record?.data.batchId) {
    const wallet = session;
    if (!wallet) throw new Error('Connect a wallet first.');
    const path = action === 'register' ? '/batches/transactions/register' : batchPath(id) + '/transactions/' + action;
    const tx = await api(path, { sender: wallet.account, ...body });
    // CID normalization is the backend's only permitted transformation.
    const expectedArgs = method === 'registerBatch' ? [{ ...args[0], certificateReference: canonicalReference(args[0].certificateReference), documentReference: canonicalReference(args[0].documentReference) }] : args;
    await sendPrepared({ ethereum: wallet.ethereum, account: wallet.account, config, tx, expected: { method, args: expectedArgs }, onPending: hash => setNotice({ kind: 'info', text: `Submitted ${hash}. Waiting for confirmation…` }) });
    setRows([]); setNextBlock(config.startBlock); setScanned(null);
    await track(id); setNotice({ kind: 'success', text: `${method} confirmed. Current batch state refreshed.` });
  }
  function canonicalReference(value) {
    const raw = value.replace(/^ipfs:\/\//, '');
    // Browser accepts canonical CIDv1 returned by upload. Existing v0 can be
    // entered after converting externally; explicit UI validation prevents ambiguity.
    if (!/^b[a-z2-7]+$/.test(raw)) throw new Error('Use the canonical CIDv1 reference returned by the document upload.');
    return 'ipfs://' + raw;
  }
  async function upload(type) {
    if (!session?.roles.MANUFACTURER) throw new Error('A manufacturer-role wallet is required to upload.');
    if (!approved) throw new Error('Confirm that an operator reviewed these documents for public publication.');
    const file = files[type]; if (!file) throw new Error('Choose a document first.');
    const result = await documentRequest({ ethereum: session.ethereum, session, config, file, documentType: type, batchId: form.batchId });
    setForm(previous => ({ ...previous, [type === 'medicine-certificate' ? 'certificateReference' : 'documentReference']: result.reference }));
    setNotice({ kind: 'success', text: `${type === 'medicine-certificate' ? 'Certificate' : 'Report'} pinned. Reference added to registration.` });
  }
  async function download(reference) {
    if (!session) throw new Error('Connect an authorized wallet to download documents.');
    const blob = await documentRequest({ ethereum: session.ethereum, session, config, reference });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'medisafe-document'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ kind: 'success', text: 'Document downloaded. Verify its issuer independently.' });
  }
  const pending = record?.pending && record.pending.id !== '0';
  const owns = same(record?.owner, session?.account), receives = pending && same(record.pending.to, session?.account);
  const active = record && !record.recalled && !record.expired;
  const displayed = dashboardBatches(rows, tab, session);
  const target = transferTarget(record, session);
  async function openTransfer(batchId) {
    await track(batchId);
    setTimeout(() => transferSection.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }
  return <div className="trace-app">
    <aside className="trace-sidebar"><a className="trace-brand" href="/traceability.html"><span>✚</span> MEDISAFE<small>CHAIN</small></a><div className="trace-side-caption">SUPPLY CHAIN WORKSPACE</div>
      <nav aria-label="Traceability workspace">{[['tracking', '◎', 'Medicine tracking'], ['manufacturer', '▦', 'Manufacturer'], ['distributor', '⇄', 'Distributor'], ['pharmacy', '✚', 'Pharmacy']].map(([key, symbol, label]) => <button key={key} className={tab === key ? 'selected' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}><span aria-hidden="true"><NavigationIcon kind={key}/></span>{label}</button>)}</nav>
      <div className="trace-sidebar-bottom"><p>Every handoff.<br/><strong>A verifiable record.</strong></p><a href="/">Open prescription management ↗</a><small>Component 01 · Local research environment</small></div></aside>
    <main className="trace-main"><header className="trace-topbar"><span>MediSafe Chain <span aria-hidden="true">/</span> Traceability</span><button disabled={busy} onClick={() => run(connect)}><span className={`trace-wallet-dot ${session ? 'connected' : ''}`} aria-hidden="true"/>{session ? short(session.account) : 'Connect wallet'} <span aria-hidden="true">↗</span></button></header>
      <div className="trace-content"><div className="trace-heading"><div><div className="trace-eyebrow">MEDICINE TRACEABILITY</div><h1>{tab === 'tracking' ? 'Follow every batch.' : `${tab[0].toUpperCase() + tab.slice(1)} dashboard`}</h1><p>{tab === 'tracking' ? 'A clear view of medicine provenance, custody and safety status.' : 'Manage your part of the medicine journey with wallet-authorized actions.'}</p></div><span className="trace-network">● {networkName(config.chainId)} / {config.chainId.toString()}</span></div>
      {!config.address && <div className="trace-notice error">Set VITE_TRACEABILITY_ADDRESS to your deployed local contract before connecting a wallet. Batch search is available when the backend is configured.</div>}
      {notice && <div className={`trace-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      {busy && <div className="trace-progress" role="status">Processing request… Please keep this page open.</div>}
      <section className="trace-card trace-search"><div><h2>Find a medicine batch</h2><p>Search using its exact, case-sensitive batch ID.</p></div><form onSubmit={event => { event.preventDefault(); run(() => track(query)); }}><label className="trace-sr-only" htmlFor="trace-query">Batch ID</label><input id="trace-query" placeholder="e.g. BATCH-2026-001" value={query} onChange={event => setQuery(event.target.value)} required/><button className="primary" disabled={busy}>Track batch <span aria-hidden="true">→</span></button></form></section>
      {tab !== 'tracking' && <section className="trace-card"><div className="trace-section-heading"><div><h2>{tab === 'manufacturer' ? 'Registered batches' : tab === 'distributor' ? 'Owned batches and incoming transfers' : 'Incoming transfers'}</h2><p>{session ? 'Discover your activity from the contract event log.' : 'Connect a role-authorized wallet to discover your batches.'}</p></div><div className="trace-actions"><button disabled={busy || !session} onClick={() => run(() => scan())}>Scan next 1,000 blocks</button><button disabled={busy || !session} onClick={() => run(() => scan(config.startBlock, true))}>Restart scan</button></div></div>{scanned && <p className="trace-muted">Scanned blocks {scanned}. Continue scanning for later activity.</p>}
        {!displayed.length ? <div className="trace-empty">{scanned ? 'No matching batches in the scanned blocks. Scan further or search an exact batch ID.' : 'No batches loaded yet.'}</div> : <div className="trace-table-wrap"><table><thead><tr><th>Batch / medicine</th><th>Custody</th><th>Status</th><th>Expires</th><th>Details</th></tr></thead><tbody>{displayed.map(row => <tr key={row.data.batchId}><td><strong>{row.data.batchId}</strong><small>{row.data.name}</small></td><td>{STAGES[Number(row.stage)]}</td><td><Status record={row}/></td><td>{date(row.data.expiresAt)}</td><td><button disabled={busy} onClick={() => run(() => track(row.data.batchId))}>View batch</button>{tab === 'distributor' && transferTarget(row, session) === 'pharmacy' && <button className="primary" disabled={busy} onClick={() => run(() => openTransfer(row.data.batchId))}>Transfer to pharmacy</button>}</td></tr>)}</tbody></table></div>}
      </section>}
      {record && <><section className="trace-card"><div className="trace-section-heading"><div><div className="trace-eyebrow">BATCH RECORD</div><h2>{record.data.name}</h2><code>{record.data.batchId}</code></div><Status record={record}/></div><dl className="trace-detail-grid">{[['Manufacturer', record.data.manufacturerName], ['Manufacturer wallet', record.manufacturer], ['Current owner', record.owner], ['Custody stage', STAGES[Number(record.stage)]], ['Medicine ID', record.data.medicineId], ['Category', record.data.category], ['Dosage form / strength', `${record.data.dosageForm} / ${record.data.strength}`], ['Quantity', record.data.quantity], ['Manufactured', date(record.data.manufacturedAt)], ['Expires', date(record.data.expiresAt)], ['Indication', record.data.indication], ['Classification', record.data.classification]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="trace-documents">{[['Medicine certificate', record.data.certificateReference], ['Laboratory test report', record.data.documentReference]].map(([label, reference]) => <div key={label}><strong>{label}</strong><code>{reference}</code><button disabled={busy || !session} onClick={() => run(() => download(reference))}>Download document ↓</button></div>)}</div><p className="trace-muted">A CID identifies content. It does not prove document authenticity or medicine safety.</p></section>
        <section className="trace-card"><h2>Custody history</h2><ol className="trace-timeline"><li><strong>Registered by manufacturer</strong><code>{record.manufacturer}</code></li>{record.history.map(entry => <li key={entry.id}><strong>Received by {STAGES[Number(entry.stage)]}</strong><p>{date(entry.confirmedAt)}</p><code>{entry.from} → {entry.to}</code></li>)}</ol>{!record.history.length && <p className="trace-muted">No completed transfers. Registration is the first custody record.</p>}</section>
        {pending && <section className="trace-card"><h2>Pending transfer #{record.pending.id}</h2><p>Awaiting recipient confirmation. Ownership has not changed.</p><code className="trace-code">{record.pending.from} → {record.pending.to}</code><p>Requested {date(record.pending.initiatedAt)} · Next stage: {STAGES[Number(record.pending.nextStage)]}</p><div className="trace-actions">{receives && <><button className="primary" disabled={busy || !active} onClick={() => run(() => transact('confirm-transfer', 'confirmTransfer', [record.data.batchId, record.pending.id], { transferId: record.pending.id }))}>Confirm receipt</button><button disabled={busy} onClick={() => run(() => transact('reject-transfer', 'cancelTransfer', [record.data.batchId, record.pending.id], { transferId: record.pending.id }))}>Reject transfer</button></>}{owns && <button disabled={busy} onClick={() => run(() => transact('cancel-transfer', 'cancelTransfer', [record.data.batchId, record.pending.id], { transferId: record.pending.id }))}>Cancel request</button>}</div></section>}
        {target && <section className="trace-card" ref={transferSection} id="trace-transfer"><h2>Transfer to {target}</h2><p>The recipient must hold the next-stage role and confirm receipt.</p><form className="trace-inline" onSubmit={event => { event.preventDefault(); run(() => transact('initiate-transfer', 'initiateTransfer', [record.data.batchId, recipient], { recipient })); }}><label htmlFor="trace-recipient">Recipient wallet</label><input id="trace-recipient" placeholder="0x…" value={recipient} onChange={event => setRecipient(event.target.value)} required pattern="0x[0-9a-fA-F]{40}"/><button className="primary" disabled={busy}>Prepare transfer</button></form></section>}
      </>}
      {tab === 'tracking' && !record && <section className="trace-intro"><div className="trace-intro-icon" aria-hidden="true">◎</div><h2>One batch. Its entire journey.</h2><p>Search a batch to see its manufacturer, completed handoffs, pending custody, documents and current safety status.</p><div><span>01 Manufacturer</span><span>→</span><span>02 Distributor</span><span>→</span><span>03 Pharmacy</span></div></section>}
      {tab === 'manufacturer' && <section className="trace-card"><div className="trace-section-heading"><div><div className="trace-eyebrow">NEW REGISTRATION</div><h2>Register a medicine batch</h2><p>Documents first, then review the wallet transaction.</p></div><span className="trace-tag">Manufacturer role required</span></div><form onSubmit={event => { event.preventDefault(); run(async () => { const batch = registration(form); await transact('register', 'registerBatch', [batch], { batch }, batch.batchId); setForm(emptyForm); setFiles({}); setApproved(false); }); }}><fieldset disabled={busy || !session?.roles.MANUFACTURER}><legend className="trace-sr-only">Batch registration details</legend><div className="trace-form-grid">{Object.entries(fields).map(([key, label]) => <label key={key}>{label}<input value={form[key]} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} type={key.endsWith('At') ? 'datetime-local' : key === 'quantity' ? 'number' : 'text'} min={key === 'quantity' ? '1' : undefined} step={key === 'quantity' ? '1' : undefined} required/></label>)}</div>
        <div className="trace-upload"><h3>Approved public documents</h3><p>Only files whose exact SHA-256 has been allowlisted by an operator can be published. Do not include patient or confidential information.</p><label className="trace-check"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)}/>These documents have been reviewed and approved for public publication.</label><div className="trace-form-grid">{[['medicine-certificate', 'Medicine certificate'], ['laboratory-report', 'Laboratory test report']].map(([type, label]) => <div key={type}><label>{label}<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => setFiles(previous => ({ ...previous, [type]: event.target.files[0] }))}/></label><button type="button" disabled={!approved || !files[type]} onClick={() => run(() => upload(type))}>Upload & pin {label.toLowerCase()}</button></div>)}</div><small>PDF, PNG or JPEG · Maximum 5 MiB · Wallet signature required</small></div><div className="trace-form-footer"><p>Review all details. Registration metadata cannot be edited on-chain.</p><button className="primary">Review & register in wallet ↗</button></div></fieldset></form>{!session?.roles.MANUFACTURER && <p className="trace-muted">Connect a wallet with MANUFACTURER_ROLE to register and upload.</p>}</section>}
      <footer className="trace-footer">MediSafe Chain · Pharmaceutical supply chain research<span>Whole-batch custody · Wallet-signed transactions</span></footer></div></main>
  </div>;
}
function Status({ record }) { return <span className={`trace-status ${record.recalled || record.expired ? 'unsafe' : ''}`}>{record.recalled ? 'Recalled' : record.expired ? 'Expired' : 'Active'}{record.recalled && record.expired ? ' · Expired' : ''}</span>; }

// Presentation-only icons; navigation and wallet handlers remain unchanged.
function NavigationIcon({ kind }) {
  const paths = {
    tracking: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4M8 10.5h5M10.5 8v5"/></>,
    manufacturer: <><path d="M3 21V9l6 3V8l6 4V3h4v18ZM3 21h18M7 17h1m4 0h1m4 0h1"/></>,
    distributor: <><path d="M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4"/></>,
    pharmacy: <><path d="M4 9h16v12H4ZM3 9l2-6h14l2 6M9 15h6m-3-3v6"/></>
  };
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">{paths[kind]}</svg>;
}
