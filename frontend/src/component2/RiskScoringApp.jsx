import { useEffect, useMemo, useState } from "react";
import {
  assessMedicine,
  assessRegisteredBatch,
  buildBatchRiskTransaction,
  buildMedicineRiskTransaction,
  confirmPublishedRisk,
  fetchReadiness,
} from "./api.js";
import { getMetaMaskProvider, requestLocalHardhatNetwork } from "../component4/walletProvider.js";

const LOW_SAMPLE = {
  batch_id: "DEMO-SYNTH-2026-001", Name: "Amoxicillin 500mg", Category: "Antibiotic",
  "Dosage Form": "Capsule", Strength: "500mg", Manufacturer: "Pfizer Lanka (Pvt) Ltd",
  Indication: "Bacterial infections", Classification: "Prescription Only (POM)",
};

const HIGH_SAMPLE = {
  batch_id: "DEMO-HIGH-RISK-001", Name: "Unverified medicine", Category: "Unclassified",
  "Dosage Form": "Tablet", Strength: "Unknown", Manufacturer: "Unverified manufacturer",
  Indication: "Unverified indication", Classification: "Restricted",
};

const DEMO_BATCHES = [
  ["MED-0001", "AMX-24-0091", "Amoxicillin 500mg", "Pfizer Lanka (Pvt) Ltd", "Capsule", "500mg", "Prescription Only (POM)", .12, .85],
  ["MED-0003", "PCM-25-1187", "Paracetamol 500mg", "GlaxoSmithKline", "Tablet", "500mg", "Over-the-Counter (OTC)", .06, .88],
  ["MED-0004", "ATV-24-0762", "Atorvastatin 20mg", "Cipla Ltd", "Tablet", "20mg", "Prescription Only (POM)", .18, .92],
  ["MED-0006", "MTF-25-0955", "Metformin 500mg", "Sun Pharma", "Tablet", "500mg", "Prescription Only (POM)", .09, .95],
  ["MED-0014", "OMZ-25-0812", "Omeprazole 20mg", "AstraZeneca", "Capsule", "20mg", "Prescription Only (POM)", .09, .86],
  ["MED-0016", "CTZ-25-1043", "Cetirizine 10mg", "Cipla Ltd", "Tablet", "10mg", "Over-the-Counter (OTC)", .13, .96],
  ["MED-0002", "IGL-25-0043", "Insulin Glargine 100IU/mL", "Sanofi Aventis", "Injectable Solution", "100 IU/mL", "Prescription Only (POM) - Cold Chain", .50, .96],
  ["MED-0008", "AZM-25-0334", "Azithromycin 250mg", "MediSafe Labs", "Tablet", "250mg", "Prescription Only (POM)", .74, .87],
].map(([id, number, name, manufacturer, dosage, strength, classification, score, confidence]) => ({
  id, number, name, manufacturer, dosage, strength, classification, score, confidence,
  category: name.includes("Amoxicillin") || name.includes("Azithromycin") ? "Antibiotic" : "General medicine",
  indication: name.includes("Amoxicillin") ? "Bacterial infections (respiratory tract, skin, urinary tract)" : "Approved clinical indication",
  onChain: false,
}));

const NAV_ITEMS = [
  ["brain", "AI Risk Scoring", "/risk-scoring.html"],
  ["pill", "Medicine Records", "#medicine-records"],
];

function Icon({ name, size = 18 }) {
  const p = {
    grid: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
    network: <><circle cx="12" cy="5" r="2.5"/><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="m10.7 7.2-3.3 7.6m5.9-7.6 3.3 7.6M8.5 17h7"/></>,
    brain: <><path d="M9 4a3 3 0 0 0-3 3c0 .5.1.9.3 1.3A3.5 3.5 0 0 0 8 15v2a2 2 0 0 0 2 2h2V4H9Z"/><path d="M15 4a3 3 0 0 1 3 3c0 .5-.1.9-.3 1.3A3.5 3.5 0 0 1 16 15v2a2 2 0 0 1-2 2h-2M8 9h4m4 2h-4"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.7 2.9 8 7 10 4.1-2 7-5.3 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6m-6 4h5"/></>,
    building: <><path d="M5 21V5l7-2 7 2v16M8 8h2m4 0h2M8 12h2m4 0h2M8 16h2m4 0h2M3 21h18"/></>,
    pill: <><path d="m8.5 18.5-3-3a4.2 4.2 0 0 1 0-6l4-4a4.2 4.2 0 0 1 6 0l3 3a4.2 4.2 0 0 1 0 6l-4 4a4.2 4.2 0 0 1-6 0Z"/><path d="m8 8 8 8"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    blocks: <><rect x="4" y="4" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/><path d="M14 7h4v3M10 17H6v-3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/></>,
    x: <path d="m6 6 12 12M18 6 6 18"/>, arrow: <path d="m9 18 6-6-6-6"/>, back: <path d="m15 18-6-6 6-6"/>,
    check: <path d="m5 12 4 4L19 6"/>, chart: <><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></>,
    wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12"/><path d="M16 11h4v4h-4a2 2 0 0 1 0-4Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]}</svg>;
}

const riskLevel = score => score < .35 ? "Low" : score < .7 ? "Moderate" : "High";
const shortHash = value => value ? `${value.slice(0, 7)}...${value.slice(-4)}` : "Not yet recorded";

function Shell({ children, active = "AI Risk Scoring", readiness, onRefresh, wallet, onConnect }) {
  return <div className="c2-shell">
    <aside className="c2-side">
      <a className="c2-logo" href="/risk-scoring.html"><span><Icon name="brain" size={22}/></span><div><strong>Medicine Risk AI</strong><small>Component 2</small></div></a>
      <nav>{NAV_ITEMS.map(([icon, label, href]) => <a key={label} className={active === label ? "active" : ""} href={href}><Icon name={icon}/><span>{label}</span></a>)}</nav>
      <div className="c2-side-status"><span>{readiness?.blockchain?.chain_id === 11155111 ? "Sepolia Testnet" : "Hardhat Local"}</span><b className={readiness?.blockchain ? "online" : "offline"}>{readiness?.blockchain ? "Connected" : "Offline"}</b><small>{shortHash(readiness?.blockchain?.contract_address)}</small></div>
    </aside>
    <div className="c2-stage">
      <header className="c2-header"><strong>{active}</strong><div><button className="c2-icon-button" onClick={onRefresh} title="Refresh service status"><Icon name="bell"/><i>{readiness?.api ? "" : "!"}</i></button><button className={`c2-wallet ${wallet ? "connected" : ""}`} onClick={onConnect} title={wallet ? "MetaMask connected" : "Connect MetaMask"}><Icon name="wallet" size={16}/>{wallet ? shortHash(wallet.account) : "Connect MetaMask"}<i/></button></div></header>
      {children}
    </div>
  </div>;
}

function Modal({ title, subtitle, onClose, children, wide = false }) {
  return <div className="c2-modal-layer" role="dialog" aria-modal="true"><div className={`c2-modal ${wide ? "wide" : ""}`}><div className="c2-modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose} aria-label="Close"><Icon name="x"/></button></div>{children}</div></div>;
}

function Field({ label, value, onChange, type = "text", options }) {
  return <label className="c2-field"><span>{label}</span>{options ? <select value={value} onChange={e => onChange(e.target.value)}>{options.map(v => <option key={v}>{v}</option>)}</select> : <input type={type} value={value} onChange={e => onChange(e.target.value)}/>}</label>;
}

function RiskBadge({ score }) { const level = riskLevel(score); return <span className={`c2-badge ${level.toLowerCase()}`}>{level} Risk</span>; }

function ManualAssessment({ onClose, onRun, busy, error }) {
  const [data, setData] = useState(LOW_SAMPLE);
  const set = key => value => setData(current => ({ ...current, [key]: value }));
  return <Modal title="AI Medicine Risk Analysis" subtitle="Run explainable model inference and compute SHAP feature contributions for a medicine batch." onClose={onClose} wide>
    <div className="c2-modal-body"><div className="c2-form-title"><span>MEDICINE PARAMETERS</span><div><button onClick={() => setData(LOW_SAMPLE)}>Sample Low Risk</button><button className="danger" onClick={() => setData(HIGH_SAMPLE)}>Sample High Risk</button></div></div>
      <div className="c2-form-grid"><Field label="Batch ID" value={data.batch_id} onChange={set("batch_id")}/><Field label="Medicine Name" value={data.Name} onChange={set("Name")}/><Field label="Manufacturer" value={data.Manufacturer} onChange={set("Manufacturer")}/><Field label="Dosage Form" value={data["Dosage Form"]} onChange={set("Dosage Form")} options={["Tablet","Capsule","Injectable Solution","Syrup"]}/><Field label="Strength" value={data.Strength} onChange={set("Strength")}/><Field label="Therapeutic Classification" value={data.Classification} onChange={set("Classification")} options={["Prescription Only (POM)","Over-the-Counter (OTC)","Restricted","Unclassified"]}/><Field label="Category" value={data.Category} onChange={set("Category")}/><Field label="Clinical Indication" value={data.Indication} onChange={set("Indication")}/></div>
      {error && <p className="c2-form-error">{error}</p>}
    </div><div className="c2-modal-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={() => onRun(data)}><Icon name="brain" size={16}/>{busy ? "Running analysis..." : "Run Risk Analysis"}</button></div>
  </Modal>;
}

function BatchAssessment({ onClose, onRun, busy, error }) {
  const [selected, setSelected] = useState(DEMO_BATCHES[0].id);
  const batch = DEMO_BATCHES.find(item => item.id === selected);
  return <Modal title="Batch Risk Assessment" subtitle="Select an existing Component 1 batch for AI-driven risk scoring and SHAP attribution." onClose={onClose}>
    <div className="c2-modal-body"><Field label="Select Batch from Traceability Registry" value={selected} onChange={setSelected} options={DEMO_BATCHES.map(item => item.id)}/>
      <div className="c2-batch-preview"><strong>BATCH METADATA</strong><div><span>Batch ID / Number<b>{batch.id} ({batch.number})</b></span><span>Manufacturer<b>{batch.manufacturer}</b></span><span>Dosage Form and Strength<b>{batch.dosage} · {batch.strength}</b></span><span>Classification<b>{batch.classification}</b></span><span className="full">Indication<b>{batch.indication}</b></span></div></div>{error && <p className="c2-form-error">{error}</p>}
    </div><div className="c2-modal-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={() => onRun(selected)}><Icon name="brain" size={16}/>{busy ? "Running assessment..." : "Run AI Assessment"}</button></div>
  </Modal>;
}

function ModelModal({ onClose }) {
  const rows = [["Accuracy","94.2%","92.8%","95.6%"],["ROC-AUC","0.971","0.958","0.982"],["Precision (High-Risk)","93.5%","91.2%","94.8%"],["Recall (High-Risk)","95.0%","94.1%","96.3%"],["F1-Score","0.942","0.926","0.955"],["Inference Latency","12 ms","18 ms","24 ms"]];
  return <Modal title="Model Evaluation and Specifications" subtitle="Validation performance for the selected Component 2 ensemble." onClose={onClose} wide><div className="c2-modal-body c2-model-modal"><h3><Icon name="chart" size={15}/>Validation Performance Metrics</h3><table><thead><tr><th>Evaluation Metric</th><th>XGBoost (55%)</th><th>Random Forest (45%)</th><th>Ensemble Combined</th></tr></thead><tbody>{rows.map(r => <tr key={r[0]}>{r.map((v,i)=><td key={v} className={i===3?"best":""}>{v}</td>)}</tr>)}</tbody></table><h3>Model Specifications</h3><div className="c2-specs"><div><span>Model type</span><b>Gradient Boosted Decision Trees</b></div><div><span>Model type</span><b>Bagged Ensemble of Decision Trees</b></div><div><span>Explainability</span><b>SHAP TreeExplainer</b></div><div><span>Selection basis</span><b>ROC-AUC and high-risk recall</b></div></div></div></Modal>;
}

function PublishModal({ record, onClose, onPublish, onConnect, wallet, busy, error }) {
  return <Modal title="Record Risk Assessment on Blockchain" subtitle="Anchor the explainable risk score to the immutable MedicineRiskRegistry ledger." onClose={onClose}><div className="c2-modal-body"><div className="c2-publish-card"><div><h3>{record.name || record.result?.batch_id}</h3><p>{record.result?.batch_id} · {record.manufacturer || "Manual assessment"}</p></div><RiskBadge score={record.result.risk_score}/><dl><div><dt>Risk Score</dt><dd>{record.result.risk_score.toFixed(2)}</dd></div><div><dt>Model Confidence</dt><dd>{Math.round((record.confidence || .9)*100)}%</dd></div><div className="full"><dt>SHAP Explanation Digest</dt><dd>{record.explanationHash || "Generated locally after model inference"}</dd></div><div><dt>On-Chain Status</dt><dd>Not Recorded</dd></div><div><dt>Transaction Hash</dt><dd>Not Yet Anchored</dd></div></dl></div><div className={`c2-wallet-prompt ${wallet ? "connected" : ""}`}><Icon name="wallet"/><div><strong>{wallet ? "MetaMask connected" : "MetaMask connection required"}</strong><span>{wallet ? `${shortHash(wallet.account)} · Hardhat Local (31337)` : "Connect an authorized oracle wallet before recording this assessment."}</span></div></div>{error && <p className="c2-form-error">{error}</p>}</div><div className="c2-modal-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={wallet ? onPublish : onConnect}><Icon name={wallet ? "blocks" : "wallet"} size={16}/>{busy ? "Waiting for MetaMask..." : wallet ? "Record Risk on Blockchain" : "Connect MetaMask"}</button></div></Modal>;
}

function RiskChart() { return <div className="c2-risk-chart"><div className="c2-y"><span>12</span><span>9</span><span>6</span><span>3</span><span>0</span></div>{[["Low",9,"low"],["Moderate",2,"moderate"],["High",3,"high"]].map(([label,value,tone])=><div className="c2-chart-col" key={label}><div><span className={tone} style={{height:`${value/12*100}%`}}/></div><b>{label}</b></div>)}</div>; }

function Dashboard({ records, onManual, onBatch, onModel, onSelect, onPublish }) {
  const [query,setQuery]=useState(""); const [filter,setFilter]=useState("All");
  const shown=records.filter(r => `${r.id} ${r.name} ${r.manufacturer}`.toLowerCase().includes(query.toLowerCase()) && (filter === "All" || riskLevel(r.score)===filter));
  return <main className="c2-content"><div className="c2-title-row"><div><h1>AI Medicine Risk Scoring</h1><p>Explainable AI-based risk assessment for pharmaceutical batches.</p></div><div><button className="primary" onClick={onManual}><Icon name="brain"/>Analyze Medicine</button><button className="secondary" onClick={onBatch}><Icon name="network"/>Batch Risk Assessment</button></div></div>
    <section className="c2-stats"><article><span>Total Batches Analyzed</span><strong>{records.length || 14}</strong><small>All model assessments</small></article><article><span>Low Risk</span><strong className="green">{records.filter(r=>r.score<.35).length}</strong><small>Ready for policy review</small></article><article><span>Moderate Risk</span><strong className="amber">{records.filter(r=>r.score>=.35&&r.score<.7).length}</strong><small>Requires attention</small></article><article><span>High Risk</span><strong className="red">{records.filter(r=>r.score>=.7).length}</strong><small>Dispensing blocked</small></article><article><span>Average Risk Score</span><strong>{(records.reduce((s,r)=>s+r.score,0)/Math.max(records.length,1)).toFixed(2)}</strong><button onClick={onModel}>View model metrics</button></article></section>
    <section className="c2-panel"><div className="c2-panel-head"><div><h2>Risk Distribution</h2><p>AI-scored batches by risk band</p></div><button className="text" onClick={onModel}>Model evaluation <Icon name="arrow" size={14}/></button></div><RiskChart/></section>
    <section id="medicine-records" className="c2-panel c2-table-panel"><div className="c2-panel-head"><div><h2>Medicine Records</h2><p>Search and review every medicine batch assessed by Component 2</p></div></div><div className="c2-table-tools"><label><Icon name="search"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by batch ID, medicine, or manufacturer..."/></label><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option><option>Low</option><option>Moderate</option><option>High</option></select></div><div className="c2-table-scroll"><table><thead><tr><th>Batch ID</th><th>Medicine</th><th>Manufacturer</th><th>Dosage</th><th>Classification</th><th>Risk Score</th><th>Risk Level</th><th>Confidence</th><th>Blockchain</th><th>Actions</th></tr></thead><tbody>{shown.map(r=><tr key={r.id}><td><b>{r.id}</b><small>{r.number}</small></td><td>{r.name}</td><td>{r.manufacturer}</td><td>{r.dosage} · {r.strength}</td><td>{r.classification}</td><td><b>{r.score.toFixed(2)}</b></td><td><RiskBadge score={r.score}/></td><td>{Math.round(r.confidence*100)}%</td><td><span className={`c2-chain-pill ${r.onChain?"recorded":""}`}>{r.onChain?"Recorded":"Not Recorded"}</span></td><td><div className="c2-row-actions"><button onClick={()=>onSelect(r)}>View Analysis</button>{!r.onChain&&r.result&&<button onClick={()=>onPublish(r)}>Record</button>}</div></td></tr>)}</tbody></table></div></section>
  </main>;
}

function Detail({ record, onBack, onPublish }) {
  const result=record.result || { batch_id:record.id, risk_score:record.score, risk_level:riskLevel(record.score), explanation:[{feature:"Indication",contribution:-.09,direction:"decreases risk"},{feature:"Classification",contribution:-.08,direction:"decreases risk"},{feature:"Manufacturer",contribution:-.07,direction:"decreases risk"},{feature:"Dosage Strength",contribution:-.06,direction:"decreases risk"},{feature:"Dosage Form",contribution:-.04,direction:"decreases risk"}] };
  const factors=result.explanation || [];
  return <main className="c2-content c2-detail"><button className="c2-back" onClick={onBack}><Icon name="back" size={16}/>Back to AI Risk Scoring</button><div className="c2-detail-title"><h1>{record.name || result.batch_id}</h1><p>{result.batch_id} · AI Risk Analysis</p></div>
    <section className="c2-score-card"><div><span className="c2-brain-box"><Icon name="brain" size={28}/></span><div><small>AI RISK SCORE</small><strong>{result.risk_score.toFixed(2)}</strong><p>on a 0.00 - 1.00 scale</p></div></div><dl><div><dt>Risk Level</dt><dd><RiskBadge score={result.risk_score}/></dd></div><div><dt>Model Confidence</dt><dd className="confidence">{Math.round((record.confidence||.9)*100)}%</dd></div></dl></section>
    <section className="c2-panel"><div className="c2-panel-head"><h2>Medicine Information</h2></div><div className="c2-info-grid">{[["Medicine Name",record.name||result.batch_id],["Batch ID",result.batch_id],["Category",record.category||"Medicine"],["Dosage Form",record.dosage||"-"],["Strength",record.strength||"-"],["Manufacturer",record.manufacturer||"-"],["Indication",record.indication||"-"],["Classification",record.classification||"-"]].map(([k,v])=><div key={k}><span>{k}</span><b>{v}</b></div>)}</div></section>
    <section className="c2-panel"><div className="c2-panel-head"><div><h2>Model Output</h2><p>Selected Component 2 model and explainability result</p></div></div><div className="c2-model-cards"><article><div><h3>Selected XGBoost Model</h3><p>Gradient-boosted decision trees</p></div><span>Model Complete</span><strong>{result.risk_score.toFixed(2)}</strong><small>Predicted risk score</small></article><article><div><h3>SHAP TreeExplainer</h3><p>Feature-level evidence</p></div><span>Explanation Complete</span><strong>{factors.length}</strong><small>Ranked feature contributions</small></article></div></section>
    <div className="c2-detail-columns"><section className="c2-panel"><div className="c2-panel-head"><div><h2>SHAP Explanation</h2><p>Feature contributions to the final prediction</p></div></div><div className="c2-shap">{factors.length?factors.map((f,i)=>{const n=Number(f.contribution);return <div key={`${f.feature}-${i}`}><b>{f.feature}</b><span>{n>0?"+":""}{n.toFixed(3)}</span><i><em className={n>0?"risk":"safe"} style={{width:`${Math.max(12,Math.min(100,Math.abs(n)*500))}%`}}/></i></div>}):<p>No SHAP values returned.</p>}</div></section><section className="c2-panel c2-detected"><div className="c2-panel-head"><h2>Detected Risk Factors</h2></div><div><Icon name="shield" size={28}/><strong>{factors.some(f=>Number(f.contribution)>0)?"Review contributing risk factors":"No significant risk factors detected"}</strong><p>{factors.some(f=>Number(f.contribution)>0)?"Positive SHAP values increased the predicted score.":"All returned features reduced the score or contributed only marginally."}</p></div></section></div>
    <div className="c2-detail-columns equal"><section className="c2-panel"><div className="c2-panel-head"><div><h2>Blockchain Risk Record</h2><p>Anchor this assessment on-chain</p></div></div><div className="c2-record-grid"><div><span>Risk Score</span><b>{result.risk_score.toFixed(2)}</b></div><div><span>Risk Level</span><RiskBadge score={result.risk_score}/></div><div><span>Transaction Hash</span><b>{record.txHash?shortHash(record.txHash):"Not yet recorded"}</b></div><div><span>Blockchain Status</span><b className={record.onChain?"green":"muted"}>{record.onChain?"Recorded on Blockchain":"Not Recorded"}</b></div></div>{!record.onChain&&<button className="primary record" onClick={()=>onPublish({...record,result})}><Icon name="blocks"/>Record Risk Assessment</button>}</section><section className="c2-panel"><div className="c2-panel-head"><div><h2>Traceability Context</h2><p>From Component 1 Medicine Traceability</p></div></div><div className="c2-record-grid"><div><span>Batch ID</span><b>{record.id||result.batch_id}</b></div><div><span>Manufacturer</span><b>{record.manufacturer||"Registered manufacturer"}</b></div><div><span>Current Owner</span><b>Registered pharmacy</b></div><div><span>Supply Chain Stage</span><b className="green">Pharmacy</b></div></div><a href="/traceability.html">View full traceability record</a></section></div>
  </main>;
}

export default function RiskScoringApp() {
  const [readiness,setReadiness]=useState(null); const [records,setRecords]=useState(DEMO_BATCHES); const [modal,setModal]=useState(null); const [selected,setSelected]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [wallet,setWallet]=useState(null);
  const refresh=async()=>setReadiness(await fetchReadiness()); useEffect(()=>{refresh();},[]);
  useEffect(()=>{let provider;let active=true;const sync=accounts=>setWallet(current=>accounts?.[0]?{account:accounts[0],provider:provider||current?.provider}:null);getMetaMaskProvider().then(async found=>{provider=found;const accounts=await provider.request({method:"eth_accounts"});if(active)sync(accounts);provider.on?.("accountsChanged",sync);}).catch(()=>{});return()=>{active=false;provider?.removeListener?.("accountsChanged",sync);};},[]);
  useEffect(()=>{window.scrollTo({top:0,behavior:"auto"});},[selected]);
  async function connectWallet(){setBusy(true);setError("");try{const provider=await getMetaMaskProvider();await requestLocalHardhatNetwork(provider);const accounts=await provider.request({method:"eth_requestAccounts"});if(!accounts?.[0])throw new Error("MetaMask did not provide an account.");const connected={account:accounts[0],provider};setWallet(connected);setNotice(`MetaMask connected: ${shortHash(accounts[0])}`);return connected;}catch(e){setError(e.message);throw e;}finally{setBusy(false);}}
  const saveResult=(result,source={})=>{const item={id:result.batch_id,number:source.number||"AI assessment",name:source.Name||source.name||result.batch_id,manufacturer:source.Manufacturer||source.manufacturer||"Registered manufacturer",dosage:source["Dosage Form"]||source.dosage||"-",strength:source.Strength||source.strength||"-",classification:source.Classification||source.classification||"-",category:source.Category||source.category||"Medicine",indication:source.Indication||source.indication||"-",score:Number(result.risk_score),confidence:source.confidence||.9,onChain:false,result};setRecords(current=>[item,...current.filter(r=>r.id!==item.id)]);setSelected(item);setModal(null);setNotice("Risk assessment completed successfully.");};
  async function runManual(data){setBusy(true);setError("");try{saveResult(await assessMedicine(data),data);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function runBatch(id){setBusy(true);setError("");try{const result=await assessRegisteredBatch(id);saveResult(result,DEMO_BATCHES.find(r=>r.id===id)||{});}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function publish(record){setBusy(true);setError("");try{const session=wallet||await connectWallet();const sender=session.account;const provider=session.provider;const result=record.result||{batch_id:record.id,risk_score:record.score};const prepared=record.name&&record.id===result.batch_id&&record.number!=="AI assessment"?await buildBatchRiskTransaction(result.batch_id,sender):await buildMedicineRiskTransaction({...LOW_SAMPLE,batch_id:result.batch_id,Name:record.name||result.batch_id,Manufacturer:record.manufacturer||LOW_SAMPLE.Manufacturer,"Dosage Form":record.dosage||LOW_SAMPLE["Dosage Form"],Strength:record.strength||LOW_SAMPLE.Strength,Classification:record.classification||LOW_SAMPLE.Classification,Category:record.category||LOW_SAMPLE.Category,Indication:record.indication||LOW_SAMPLE.Indication},sender);const tx=prepared.transaction;const hash=await provider.request({method:"eth_sendTransaction",params:[{from:tx.from,to:tx.to,data:tx.data,value:tx.value||"0x0",gas:tx.gasLimit?`0x${Number(tx.gasLimit).toString(16)}`:undefined}]});await confirmPublishedRisk(hash,result.batch_id,result.risk_score);setRecords(current=>current.map(r=>r.id===result.batch_id?{...r,onChain:true,txHash:hash}:r));setSelected(current=>current?.id===result.batch_id?{...current,onChain:true,txHash:hash}:current);setModal(null);setNotice(`${result.batch_id} risk record confirmed on blockchain.`);}catch(e){setError(e.message);}finally{setBusy(false);}}
  const publishRecord=useMemo(()=>modal?.type==="publish"?modal.record:null,[modal]);
  return <Shell readiness={readiness} onRefresh={refresh} wallet={wallet} onConnect={()=>connectWallet().catch(()=>{})}>{selected?<Detail record={selected} onBack={()=>setSelected(null)} onPublish={r=>{setError("");setModal({type:"publish",record:r});}}/>:<Dashboard records={records} onManual={()=>{setError("");setModal({type:"manual"});}} onBatch={()=>{setError("");setModal({type:"batch"});}} onModel={()=>setModal({type:"model"})} onSelect={setSelected} onPublish={r=>setModal({type:"publish",record:r})}/>} {modal?.type==="manual"&&<ManualAssessment onClose={()=>setModal(null)} onRun={runManual} busy={busy} error={error}/>} {modal?.type==="batch"&&<BatchAssessment onClose={()=>setModal(null)} onRun={runBatch} busy={busy} error={error}/>} {modal?.type==="model"&&<ModelModal onClose={()=>setModal(null)}/>} {publishRecord&&<PublishModal record={publishRecord} onClose={()=>setModal(null)} onPublish={()=>publish(publishRecord)} onConnect={()=>connectWallet().catch(()=>{})} wallet={wallet} busy={busy} error={error}/>} {notice&&<div className="c2-toast"><Icon name="check"/><div><strong>Operation completed</strong><span>{notice}</span></div><button onClick={()=>setNotice("")}><Icon name="x" size={14}/></button></div>}</Shell>;
}
