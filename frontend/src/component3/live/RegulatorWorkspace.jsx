import { useState } from 'react';
import { useLiveAction, useLiveResource } from './hooks.js';
import { ActionStatus, FieldError, ResourceState, Section } from './liveUi.jsx';
import CalculationPanel from './CalculationPanel.jsx';
import { canDo, formatTime, regulatorRow, visibleActions } from './liveModel.js';
import { ACTION_TYPES, ITEM_RESULTS, validateComplaintForm, validateInspectionForm, validateRecallForm, validateScreening } from './validators.js';

const TABS = [
  { id: 'overview', label: 'Overview', action: 'overview.read' },
  { id: 'recalls', label: 'Recalls', action: 'recall.issue' },
  { id: 'complaints', label: 'Complaints', action: 'complaint.log' },
  { id: 'inspections', label: 'Inspections', action: 'inspection.record' },
  { id: 'audit', label: 'Audit log', action: 'auditLog.read' },
];
const label = text => text.charAt(0) + text.slice(1).toLowerCase().replace(/_/g, ' ');
const emptyRecall = () => ({ batchReference: '', reason: '', pharmacyCodes: [], actions: Object.fromEntries(ACTION_TYPES.map(type => [type, { checked: false, dueAt: '' }])) });

/** Regulator: overview of all pharmacies, calculation detail, snapshots, recall/complaint/inspection processes, audit log. */
export default function RegulatorWorkspace({ client, session, onAuthError }) {
  const tabs = visibleActions(session, TABS);
  const [tab, setTab] = useState(tabs[0]?.id || 'overview');
  const [selected, setSelected] = useState('');

  const overview = useLiveResource(async () => {
    const summaries = await client.getRegulatorOverview();
    const calculations = await Promise.all(summaries.map(item => client.getCalculation(item.pharmacyId).catch(() => null)));
    return summaries.map((item, index) => regulatorRow(item, calculations[index]));
  }, [client], onAuthError);
  const directory = useLiveResource(() => client.getPharmacyDirectory(), [client], onAuthError);

  return <div className="c3-live-grid">
    <nav className="c3-live-tabs" aria-label="Regulator workspace sections">
      {tabs.map(item => <button key={item.id} type="button" className={tab === item.id ? 'selected' : ''} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </nav>
    {tab === 'overview' && <OverviewTab client={client} session={session} overview={overview} selected={selected} setSelected={setSelected} onAuthError={onAuthError}/>}
    {tab === 'recalls' && <RecallsTab client={client} directory={directory} overview={overview} onAuthError={onAuthError}/>}
    {tab === 'complaints' && <ComplaintsTab client={client} session={session} directory={directory} overview={overview} onAuthError={onAuthError}/>}
    {tab === 'inspections' && <InspectionsTab client={client} session={session} directory={directory} overview={overview} onAuthError={onAuthError}/>}
    {tab === 'audit' && <AuditTab client={client} onAuthError={onAuthError}/>}
  </div>;
}

function OverviewTab({ client, session, overview, selected, setSelected, onAuthError }) {
  const detail = useLiveResource(async () => {
    if (!selected) return null;
    const [calculation, findings] = await Promise.all([client.getCalculation(selected), client.getCriticalFindings(selected)]);
    return { calculation, findings };
  }, [client, selected], onAuthError);
  const snapshot = useLiveAction(onAuthError);
  const [stored, setStored] = useState(null);

  return <>
    <Section eyebrow="ALL PHARMACIES" title="Trust overview" actions={<button type="button" className="c3-secondary" onClick={overview.reload} disabled={overview.loading}>Refresh</button>}>
      <p className="c3-muted">Decision support, not a regulatory determination. Not assessable is never shown as 0.</p>
      <ResourceState resource={overview} emptyText="No pharmacies are available.">
        {rows => <div className="c3-table-wrap"><table className="c3-ha-table c3-live-table">
          <caption>Indicators show records meeting the rule over eligible records.</caption>
          <thead><tr><th scope="col">Pharmacy</th><th scope="col">Score</th><th scope="col">Tier</th>
            <th scope="col">D</th><th scope="col">R</th><th scope="col">C</th><th scope="col">I (points)</th><th scope="col">Critical escalation</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.pharmacyId} className={row.pharmacyId === selected ? 'selected' : undefined}>
            <th scope="row"><button type="button" className="c3-link" onClick={() => { setSelected(row.pharmacyId); setStored(null); snapshot.reset(); }}>{row.pharmacyId}</button></th>
            <td className="c3-num">{row.scoreText}</td><td>{row.tierText}</td>
            {row.indicators.map(item => <td key={item.letter} className="c3-num">{item.text}</td>)}
            <td className={row.criticalEscalationRequired ? 'c3-critical' : undefined}>{row.criticalEscalationRequired ? 'Required' : 'No'}</td>
          </tr>)}</tbody>
        </table></div>}
      </ResourceState>
    </Section>

    {selected && <Section eyebrow="PHARMACY DETAIL" title={selected} actions={<button type="button" className="c3-secondary" onClick={() => setSelected('')}>Close</button>}>
      <ResourceState resource={detail} isEmpty={data => !data}>
        {data => <CalculationPanel data={data.calculation} findings={data.findings}/>}
      </ResourceState>
      {canDo(session, 'snapshot.finalize') && <div className="c3-live-snapshot">
        <h3 className="c3-live-subtitle">Assessment snapshot</h3>
        <p className="c3-muted">Stores the assessment as computed now, with its sha256 hash. No blockchain transaction is sent.</p>
        <button type="button" className="c3-primary" disabled={snapshot.pending}
          onClick={() => snapshot.run(() => client.finalizeSnapshot(selected), 'Snapshot stored.', result => setStored(result))}>
          {snapshot.pending ? 'Finalising…' : 'Finalise snapshot'}</button>
        <ActionStatus action={snapshot}/>
        {stored && <dl className="c3-validation-list c3-live-hash">
          <dt>sha256</dt><dd><code>{stored.assessmentHash}</code></dd>
          <dt>Status</dt><dd>{stored.snapshot?.status === 'ASSESSABLE' ? `Assessable · ${stored.snapshot.tier}` : 'Not assessable'}</dd>
          <dt>Blockchain verification</dt><dd>NOT PERFORMED</dd>
        </dl>}
      </div>}
    </Section>}
  </>;
}

function PharmacySelect({ id, value, onChange, directory, disabled, error }) {
  return <div className="c3-field"><label htmlFor={id}>Pharmacy</label>
    <select id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={`${id}-error`}>
      <option value="">Choose a pharmacy</option>
      {(directory.data || []).map(item => <option key={item.pharmacy_code} value={item.pharmacy_code}>{item.pharmacy_code} · {item.display_name}</option>)}
    </select><FieldError id={`${id}-error`} message={error}/></div>;
}

function RecallsTab({ client, directory, overview, onAuthError }) {
  const recalls = useLiveResource(() => client.getRegulatorRecalls(), [client], onAuthError);
  const action = useLiveAction(onAuthError);
  const [form, setForm] = useState(emptyRecall);
  const [errors, setErrors] = useState({});

  async function submit(event) {
    event.preventDefault();
    const checked = validateRecallForm({
      batchReference: form.batchReference, reason: form.reason, pharmacyCodes: form.pharmacyCodes,
      actions: ACTION_TYPES.filter(type => form.actions[type].checked).map(type => ({ actionType: type, dueAt: form.actions[type].dueAt })),
    });
    setErrors(checked.errors);
    if (!checked.ok) return;
    const done = await action.run(() => client.issueRecall(checked.body), 'Recall issued.', () => Promise.all([recalls.reload(), overview.reload()]));
    if (done) setForm(emptyRecall());
  }
  const togglePharmacy = code => setForm(current => ({ ...current, pharmacyCodes: current.pharmacyCodes.includes(code)
    ? current.pharmacyCodes.filter(item => item !== code) : [...current.pharmacyCodes, code] }));
  const setAction = (type, patch) => setForm(current => ({ ...current, actions: { ...current.actions, [type]: { ...current.actions[type], ...patch } } }));

  return <>
    <Section eyebrow="RECALLS" title="Issue a recall">
      <form className="c3-live-form" onSubmit={submit} noValidate>
        <div className="c3-field"><label htmlFor="c3-rc-batch">Batch reference</label>
          <input id="c3-rc-batch" value={form.batchReference} onChange={event => setForm({ ...form, batchReference: event.target.value })} disabled={action.pending} aria-describedby="c3-rc-batch-error"/>
          <FieldError id="c3-rc-batch-error" message={errors.batchReference}/></div>
        <div className="c3-field"><label htmlFor="c3-rc-reason">Reason</label>
          <textarea id="c3-rc-reason" rows={2} value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} disabled={action.pending} aria-describedby="c3-rc-reason-error"/>
          <FieldError id="c3-rc-reason-error" message={errors.reason}/></div>
        <fieldset><legend>Pharmacies</legend>
          {(directory.data || []).map(item => <label key={item.pharmacy_code} className="c3-live-check">
            <input type="checkbox" checked={form.pharmacyCodes.includes(item.pharmacy_code)} onChange={() => togglePharmacy(item.pharmacy_code)} disabled={action.pending}/> {item.pharmacy_code}
          </label>)}
          <FieldError id="c3-rc-pharmacies-error" message={errors.pharmacyCodes}/></fieldset>
        <fieldset><legend>Required actions and due times</legend>
          {ACTION_TYPES.map(type => <div key={type} className="c3-live-action-row">
            <label className="c3-live-check"><input type="checkbox" checked={form.actions[type].checked} onChange={event => setAction(type, { checked: event.target.checked })} disabled={action.pending}/> {label(type)}</label>
            <label className="c3-sr-only" htmlFor={`c3-rc-due-${type}`}>Due time for {label(type)}</label>
            <input id={`c3-rc-due-${type}`} type="datetime-local" value={form.actions[type].dueAt} onChange={event => setAction(type, { dueAt: event.target.value })}
              disabled={action.pending || !form.actions[type].checked} aria-describedby={`c3-rc-due-${type}-error`}/>
            <FieldError id={`c3-rc-due-${type}-error`} message={errors[`due_${type}`]}/>
          </div>)}
          <FieldError id="c3-rc-actions-error" message={errors.actions}/></fieldset>
        <button className="c3-primary" type="submit" disabled={action.pending}>{action.pending ? 'Issuing…' : 'Issue recall'}</button>
        <ActionStatus action={action}/>
      </form>
    </Section>
    <Section eyebrow="ISSUED" title="Recalls">
      <ResourceState resource={recalls} emptyText="No recalls issued yet.">
        {rows => <ul className="c3-list">{rows.map(row => <li key={row.id}><strong>{row.recall_ref}</strong> · {row.batch_reference} · issued {formatTime(row.issued_at)} · {row.completed_count ?? 0}/{row.action_count ?? 0} actions completed</li>)}</ul>}
      </ResourceState>
    </Section>
  </>;
}

function ComplaintsTab({ client, session, directory, overview, onAuthError }) {
  const complaints = useLiveResource(() => client.getRegulatorComplaints(), [client], onAuthError);
  const action = useLiveAction(onAuthError);
  const [form, setForm] = useState({ pharmacyCode: '', summary: '' });
  const [errors, setErrors] = useState({});
  const refresh = () => Promise.all([complaints.reload(), overview.reload()]);

  async function submit(event) {
    event.preventDefault();
    const checked = validateComplaintForm(form);
    setErrors(checked.errors);
    if (!checked.ok) return;
    const done = await action.run(() => client.logComplaint(checked.body), 'Complaint logged.', refresh);
    if (done) setForm({ pharmacyCode: '', summary: '' });
  }
  const screen = (row, outcome) => {
    const checked = validateScreening({ outcome });
    if (checked.ok) action.run(() => client.screenComplaint(row.id, checked.body), `Complaint ${row.complaint_ref} screened as ${label(outcome).toLowerCase()}.`, refresh);
  };

  return <>
    <Section eyebrow="COMPLAINTS" title="Log a complaint">
      <form className="c3-live-form" onSubmit={submit} noValidate>
        <PharmacySelect id="c3-cp-pharmacy" value={form.pharmacyCode} onChange={value => setForm({ ...form, pharmacyCode: value })} directory={directory} disabled={action.pending} error={errors.pharmacyCode}/>
        <div className="c3-field"><label htmlFor="c3-cp-summary">Summary</label>
          <textarea id="c3-cp-summary" rows={3} value={form.summary} onChange={event => setForm({ ...form, summary: event.target.value })} disabled={action.pending} aria-describedby="c3-cp-summary-error"/>
          <FieldError id="c3-cp-summary-error" message={errors.summary}/></div>
        <button className="c3-primary" type="submit" disabled={action.pending}>{action.pending ? 'Saving…' : 'Log complaint'}</button>
        <ActionStatus action={action}/>
      </form>
    </Section>
    <Section eyebrow="OPEN" title="Complaints awaiting screening or resolution">
      <ResourceState resource={complaints} emptyText="No open complaints.">
        {rows => <ul className="c3-live-tasks">{rows.map(row => <li key={row.id} className="c3-live-task">
          <p><strong>{row.complaint_ref}</strong> · {row.pharmacy_code} · {row.status === 'LOGGED' ? 'Awaiting screening' : `Substantiated · resolve by ${formatTime(row.resolution_due_at)}`}</p>
          <p className="c3-muted">{row.summary}</p>
          {row.status === 'LOGGED' && canDo(session, 'complaint.screen') && <div className="c3-live-buttons">
            <button type="button" className="c3-primary" disabled={action.pending} onClick={() => screen(row, 'SUBSTANTIATED')}>Substantiated</button>
            <button type="button" className="c3-secondary" disabled={action.pending} onClick={() => screen(row, 'UNSUBSTANTIATED')}>Unsubstantiated</button>
          </div>}
        </li>)}</ul>}
      </ResourceState>
    </Section>
  </>;
}

function InspectionsTab({ client, session, directory, overview, onAuthError }) {
  const criteria = useLiveResource(() => client.getInspectionCriteria(), [client], onAuthError);
  const inspections = useLiveResource(() => client.getRegulatorInspections(), [client], onAuthError);
  const action = useLiveAction(onAuthError);
  const [form, setForm] = useState({ pharmacyCode: '', inspectedAt: '', items: {} });
  const [errors, setErrors] = useState({});
  const refresh = () => Promise.all([inspections.reload(), overview.reload()]);
  const item = code => form.items[code] || { result: '', critical: false, note: '' };
  const setItem = (code, patch) => setForm(current => {
    const next = { ...item(code), ...patch };
    if (next.result !== 'NON_COMPLIANT') next.critical = false;
    return { ...current, items: { ...current.items, [code]: next } };
  });

  async function submit(event) {
    event.preventDefault();
    const checked = validateInspectionForm({
      pharmacyCode: form.pharmacyCode, inspectedAt: form.inspectedAt,
      items: Object.entries(form.items).map(([criterionCode, value]) => ({ criterionCode, ...value })),
    });
    setErrors(checked.errors);
    if (!checked.ok) return;
    const done = await action.run(() => client.recordInspection(checked.body), 'Inspection recorded as a draft. Finalise it below to count it.', refresh);
    if (done) setForm({ pharmacyCode: '', inspectedAt: '', items: {} });
  }

  return <>
    <Section eyebrow="INSPECTIONS" title="Record an inspection">
      <form className="c3-live-form" onSubmit={submit} noValidate>
        <PharmacySelect id="c3-in-pharmacy" value={form.pharmacyCode} onChange={value => setForm({ ...form, pharmacyCode: value })} directory={directory} disabled={action.pending} error={errors.pharmacyCode}/>
        <div className="c3-field"><label htmlFor="c3-in-time">Inspection date and time</label>
          <input id="c3-in-time" type="datetime-local" value={form.inspectedAt} onChange={event => setForm({ ...form, inspectedAt: event.target.value })} disabled={action.pending} aria-describedby="c3-in-time-error"/>
          <FieldError id="c3-in-time-error" message={errors.inspectedAt}/></div>
        <ResourceState resource={criteria} emptyText="No inspection criteria are available.">
          {rows => <div className="c3-table-wrap"><table className="c3-ha-table c3-live-table">
            <caption>Prototype checklist; clause mapping to GL-013/GL-014/GL-033 still to be verified. Leave a result blank to skip a criterion.</caption>
            <thead><tr><th scope="col">Criterion</th><th scope="col">Result</th><th scope="col">Critical</th><th scope="col">Note</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.code}>
              <th scope="row">{row.title}<FieldError id={`c3-in-${row.code}-error`} message={errors[`item_${row.code}`]}/></th>
              <td><label className="c3-sr-only" htmlFor={`c3-in-result-${row.code}`}>Result for {row.title}</label>
                <select id={`c3-in-result-${row.code}`} value={item(row.code).result} onChange={event => setItem(row.code, { result: event.target.value })} disabled={action.pending}>
                  <option value="">Not recorded</option>
                  {ITEM_RESULTS.map(value => <option key={value} value={value}>{label(value)}</option>)}
                </select></td>
              <td><label className="c3-live-check"><input type="checkbox" checked={item(row.code).critical} onChange={event => setItem(row.code, { critical: event.target.checked })}
                disabled={action.pending || item(row.code).result !== 'NON_COMPLIANT'}/> <span className="c3-sr-only">Critical finding for {row.title}</span>Critical</label></td>
              <td><label className="c3-sr-only" htmlFor={`c3-in-note-${row.code}`}>Note for {row.title}</label>
                <input id={`c3-in-note-${row.code}`} value={item(row.code).note} onChange={event => setItem(row.code, { note: event.target.value })} disabled={action.pending || !item(row.code).result}/></td>
            </tr>)}</tbody>
          </table></div>}
        </ResourceState>
        <FieldError id="c3-in-items-error" message={errors.items}/>
        <button className="c3-primary" type="submit" disabled={action.pending}>{action.pending ? 'Saving…' : 'Record inspection'}</button>
        <ActionStatus action={action}/>
      </form>
    </Section>
    <Section eyebrow="RECORDED" title="Inspections">
      <ResourceState resource={inspections} emptyText="No inspections recorded yet.">
        {rows => <ul className="c3-live-tasks">{rows.map(row => <li key={row.id} className="c3-live-task">
          <p><strong>{row.inspection_ref}</strong> · {row.pharmacy_code} · {formatTime(row.inspected_at)} · {row.item_count ?? 0} items · {row.status === 'FINAL' ? `Final (${formatTime(row.finalised_at)})` : 'Draft (not counted)'}</p>
          {row.status === 'DRAFT' && canDo(session, 'inspection.finalize') && <button type="button" className="c3-primary" disabled={action.pending}
            onClick={() => action.run(() => client.finalizeInspection(row.id), `Inspection ${row.inspection_ref} finalised.`, refresh)}>Finalise inspection</button>}
        </li>)}</ul>}
      </ResourceState>
    </Section>
  </>;
}

function AuditTab({ client, onAuthError }) {
  const audit = useLiveResource(() => client.getAuditLog(100), [client], onAuthError);
  return <Section eyebrow="ACCOUNTABILITY" title="Audit log (latest 100)" actions={<button type="button" className="c3-secondary" onClick={audit.reload} disabled={audit.loading}>Refresh</button>}>
    <ResourceState resource={audit} emptyText="No audit entries yet.">
      {rows => <div className="c3-table-wrap"><table className="c3-ha-table c3-live-table">
        <caption>Every write is recorded by the database with the verified actor.</caption>
        <thead><tr><th scope="col">Time</th><th scope="col">Actor role</th><th scope="col">Action</th><th scope="col">Table</th><th scope="col">Record</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td>{formatTime(row.occurred_at)}</td><td>{row.actor_role}</td><td>{row.action}</td><td>{row.target_table}</td><td><code>{row.target_id}</code></td></tr>)}</tbody>
      </table></div>}
    </ResourceState>
  </Section>;
}
