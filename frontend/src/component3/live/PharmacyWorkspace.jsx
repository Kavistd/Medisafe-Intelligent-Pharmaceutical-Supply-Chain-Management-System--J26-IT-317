import { useState } from 'react';
import { useLiveAction, useLiveResource } from './hooks.js';
import { ActionStatus, FieldError, ResourceState, Section, SectionUnavailable } from './liveUi.jsx';
import CalculationPanel from './CalculationPanel.jsx';
import { calculationView, canDo, formatTime } from './liveModel.js';
import HeroCard from '../ui/HeroCard.jsx';
import { Stepper } from '../ui/Stepper.js';
import { pharmacyHeroStats, sectionAllowed } from '../ui/uiModel.js';
import { CONFIRMATION_STATUSES, validateConfirmation, validateRecallCompletion, validateResolution } from './validators.js';

const isTasksEmpty = data => !data || (data.deliveriesToConfirm.length + data.recallActionsDue.length + data.complaintsToResolve.length === 0);

/** Pharmacy user: own score with the calculation panel, task inbox, own record history. Own pharmacy only. */
export default function PharmacyWorkspace({ client, session, onAuthError, section }) {
  const code = session?.pharmacy?.code || '';
  const assessment = useLiveResource(async () => {
    const [calculation, findings] = await Promise.all([client.getCalculation(code), client.getCriticalFindings(code)]);
    return { calculation, findings };
  }, [client, code], onAuthError);
  const tasks = useLiveResource(() => client.getPharmacyTasks(), [client], onAuthError);
  const action = useLiveAction(onAuthError);
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});

  const refresh = async () => { await Promise.all([tasks.reload(), assessment.reload()]); };
  const draft = id => drafts[id] || {};
  const setDraft = (id, patch) => setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch } }));

  async function submit(id, validate, operation, message) {
    const checked = validate(draft(id));
    setErrors(current => ({ ...current, [id]: checked.errors }));
    if (!checked.ok) return;
    const done = await action.run(() => operation(checked.body), message, refresh);
    if (done) setDrafts(current => ({ ...current, [id]: {} }));
  }

  if (!sectionAllowed(session, section)) return <SectionUnavailable/>;
  const refreshButton = <button type="button" className="c3-secondary" onClick={assessment.reload} disabled={assessment.loading}>Refresh</button>;
  return <div className="c3-live-grid">
    {section === 'score' && <>
      <HeroCard badge="Pharmacy workspace" title="My trust" highlight="score"
        description="Your score, tier and separate escalation signal, calculated from recorded events."
        stats={pharmacyHeroStats(assessment.data ? calculationView(assessment.data.calculation) : null, tasks.data)}/>
      <Section eyebrow="MY PHARMACY" title={`Trust assessment · ${code}`} actions={refreshButton}>
        <ResourceState resource={assessment} isEmpty={data => !data}>
          {data => <CalculationPanel data={data.calculation} findings={data.findings} part="summary"/>}
        </ResourceState>
      </Section>
      <p className="c3-helper">Your record history is listed under “History &amp; calculation”, under each indicator's “records counted and excluded”.</p>
    </>}

    {section === 'history' && <Section eyebrow="MY PHARMACY" title={`History and calculation · ${code}`} actions={refreshButton}>
      <ResourceState resource={assessment} isEmpty={data => !data}>
        {data => <CalculationPanel data={data.calculation} findings={data.findings} part="details"/>}
      </ResourceState>
    </Section>}

    {section === 'tasks' && <Section eyebrow="TASK INBOX" title="Tasks waiting for you">
      <ActionStatus action={action}/>
      <ResourceState resource={tasks} isEmpty={isTasksEmpty} emptyText="No tasks are waiting for you.">
        {data => <>
          {data.deliveriesToConfirm.length > 0 && <><h3 className="c3-live-subtitle">Deliveries to confirm</h3>
            <ul className="c3-live-tasks">{data.deliveriesToConfirm.map(row => <li key={row.id}>
              <form className="c3-live-task" noValidate onSubmit={event => { event.preventDefault(); submit(row.id, validateConfirmation, body => client.confirmDelivery(row.id, body), `Delivery ${row.delivery_ref} confirmed.`); }}>
                <p><strong>{row.delivery_ref}</strong> from {row.distributor_code} · arrived {formatTime(row.arrived_at)} · confirm by {formatTime(row.confirm_due_at)}</p>
                <Stepper label={`Confirmation steps for ${row.delivery_ref}`} steps={[
                  { label: 'Select receipt', done: Boolean(draft(row.id).confirmationStatus) },
                  { label: 'Review note', done: Boolean(draft(row.id).confirmationStatus && (draft(row.id).confirmationStatus === 'ACCEPTED' || (draft(row.id).note || '').trim())) },
                  { label: 'Submit', done: false },
                ]}/>
                <fieldset><legend>Receipt</legend>
                  {CONFIRMATION_STATUSES.map(status => <label key={status} className="c3-live-radio">
                    <input type="radio" name={`receipt-${row.id}`} value={status} checked={draft(row.id).confirmationStatus === status}
                      onChange={() => setDraft(row.id, { confirmationStatus: status })} disabled={action.pending}/> {status.charAt(0) + status.slice(1).toLowerCase()}
                  </label>)}
                  <FieldError id={`receipt-${row.id}-error`} message={errors[row.id]?.confirmationStatus}/>
                </fieldset>
                <div className="c3-field"><label htmlFor={`note-${row.id}`}>Note {draft(row.id).confirmationStatus && draft(row.id).confirmationStatus !== 'ACCEPTED' ? '(required for partial or rejected)' : '(optional)'}</label>
                  <textarea id={`note-${row.id}`} rows={2} value={draft(row.id).note || ''} onChange={event => setDraft(row.id, { note: event.target.value })} disabled={action.pending}
                    aria-describedby={`note-${row.id}-error`}/>
                  <FieldError id={`note-${row.id}-error`} message={errors[row.id]?.note}/></div>
                {canDo(session, 'delivery.confirm') && <button className="c3-primary" type="submit" disabled={action.pending}>{action.pending ? 'Saving…' : 'Confirm receipt'}</button>}
              </form>
            </li>)}</ul></>}

          {data.recallActionsDue.length > 0 && <><h3 className="c3-live-subtitle">Recall actions due</h3>
            <ul className="c3-live-tasks">{data.recallActionsDue.map(row => <li key={row.id}>
              <form className="c3-live-task" noValidate onSubmit={event => { event.preventDefault(); submit(row.id, validateRecallCompletion, body => client.completeRecallAction(row.id, body), `${row.action_type} for ${row.recall_ref} completed.`); }}>
                <p><strong>{row.action_type}</strong> · recall {row.recall_ref} ({row.batch_reference}) · due {formatTime(row.due_at)}</p>
                <div className="c3-field"><label htmlFor={`rnote-${row.id}`}>Note (optional)</label>
                  <input id={`rnote-${row.id}`} value={draft(row.id).note || ''} onChange={event => setDraft(row.id, { note: event.target.value })} disabled={action.pending}/>
                  <FieldError id={`rnote-${row.id}-error`} message={errors[row.id]?.note}/></div>
                {canDo(session, 'recallAction.complete') && <button className="c3-primary" type="submit" disabled={action.pending}>Mark completed</button>}
              </form>
            </li>)}</ul></>}

          {data.complaintsToResolve.length > 0 && <><h3 className="c3-live-subtitle">Substantiated complaints to resolve</h3>
            <ul className="c3-live-tasks">{data.complaintsToResolve.map(row => <li key={row.id}>
              <form className="c3-live-task" noValidate onSubmit={event => { event.preventDefault(); submit(row.id, validateResolution, body => client.resolveComplaint(row.id, body), `Complaint ${row.complaint_ref} resolved.`); }}>
                <p><strong>{row.complaint_ref}</strong> · {row.summary} · resolve by {formatTime(row.resolution_due_at)}</p>
                <div className="c3-field"><label htmlFor={`cnote-${row.id}`}>Resolution note (required)</label>
                  <textarea id={`cnote-${row.id}`} rows={2} value={draft(row.id).note || ''} onChange={event => setDraft(row.id, { note: event.target.value })} disabled={action.pending}
                    aria-describedby={`cnote-${row.id}-error`}/>
                  <FieldError id={`cnote-${row.id}-error`} message={errors[row.id]?.note}/></div>
                {canDo(session, 'complaint.resolve') && <button className="c3-primary" type="submit" disabled={action.pending}>Resolve complaint</button>}
              </form>
            </li>)}</ul></>}
        </>}
      </ResourceState>
    </Section>}
  </div>;
}
