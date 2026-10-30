import { useState } from 'react';
import { useLiveAction, useLiveResource } from './hooks.js';
import { ActionStatus, FieldError, ResourceState, Section, SectionUnavailable } from './liveUi.jsx';
import { canDo, distributorDeliveryRows, formatTime } from './liveModel.js';
import { validateDeliveryForm } from './validators.js';
import HeroCard from '../ui/HeroCard.jsx';
import { Stepper } from '../ui/Stepper.js';
import { distributorHeroStats, sectionAllowed } from '../ui/uiModel.js';

/** Distributor: create deliveries, mark own deliveries arrived, list own deliveries. No scores or assessments. */
export default function DistributorWorkspace({ client, session, onAuthError, section }) {
  const deliveries = useLiveResource(async () => distributorDeliveryRows(await client.getDistributorDeliveries()), [client], onAuthError);
  const directory = useLiveResource(() => client.getPharmacyDirectory(), [client], onAuthError);
  const create = useLiveAction(onAuthError);
  const arrive = useLiveAction(onAuthError);
  const [form, setForm] = useState({ pharmacyCode: '', expectedBy: '' });
  const [errors, setErrors] = useState({});

  async function submit(event) {
    event.preventDefault();
    const checked = validateDeliveryForm(form);
    setErrors(checked.errors);
    if (!checked.ok) return;
    const created = await create.run(() => client.createDelivery(checked.body), 'Delivery created.', deliveries.reload);
    if (created) setForm({ pharmacyCode: '', expectedBy: '' });
  }

  if (!sectionAllowed(session, section)) return <SectionUnavailable/>;
  return <div className="c3-live-grid">
    <HeroCard badge="Distributor workspace" title="Deliveries" highlight="in transit"
      description="Create deliveries and record arrival. Trust scores are not shown to distributors."
      stats={deliveries.data ? distributorHeroStats(deliveries.data) : []}/>
    {section === 'newDelivery' && canDo(session, 'delivery.create') && <Section eyebrow="NEW DELIVERY" title="Create a delivery">
      <Stepper label="Delivery steps" steps={[
        { label: 'Select pharmacy', done: Boolean(form.pharmacyCode) },
        { label: 'Delivery details', done: Boolean(form.expectedBy) },
        { label: 'Submit', done: false },
      ]}/>
      <form className="c3-live-form" onSubmit={submit} noValidate>
        <div className="c3-field"><label htmlFor="c3-del-pharmacy">Pharmacy</label>
          <select id="c3-del-pharmacy" value={form.pharmacyCode} onChange={event => setForm({ ...form, pharmacyCode: event.target.value })}
            aria-invalid={Boolean(errors.pharmacyCode)} aria-describedby="c3-del-pharmacy-error" disabled={create.pending}>
            <option value="">Choose a pharmacy</option>
            {(directory.data || []).map(item => <option key={item.pharmacy_code} value={item.pharmacy_code}>{item.pharmacy_code} · {item.display_name}</option>)}
          </select><FieldError id="c3-del-pharmacy-error" message={errors.pharmacyCode}/></div>
        <div className="c3-field"><label htmlFor="c3-del-expected">Expected delivery (your local time)</label>
          <input id="c3-del-expected" type="datetime-local" value={form.expectedBy} onChange={event => setForm({ ...form, expectedBy: event.target.value })}
            aria-invalid={Boolean(errors.expectedBy)} aria-describedby="c3-del-expected-error" disabled={create.pending}/>
          <FieldError id="c3-del-expected-error" message={errors.expectedBy}/></div>
        <button className="c3-primary" type="submit" disabled={create.pending}>{create.pending ? 'Creating…' : 'Create delivery'}</button>
        <p className="c3-helper">Dispatch time is recorded by the server when you create the delivery.</p>
        <ActionStatus action={create}/>
      </form>
    </Section>}

    {section === 'deliveries' && <Section eyebrow="MY DELIVERIES" title="Deliveries" actions={<button type="button" className="c3-secondary" onClick={deliveries.reload} disabled={deliveries.loading}>Refresh</button>}>
      <ActionStatus action={arrive}/>
      <ResourceState resource={deliveries} emptyText="No deliveries yet.">
        {rows => <div className="c3-table-wrap c3-sticky-table"><table className="c3-ha-table c3-live-table">
          <caption>Your distributor's deliveries. Trust scores are not shown to distributors.</caption>
          <thead><tr><th scope="col">Reference</th><th scope="col">Pharmacy</th><th scope="col">Status</th><th scope="col">Expected by</th><th scope="col">Arrived</th><th scope="col">Pharmacy confirmation</th><th scope="col"><span className="c3-sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <th scope="row">{row.delivery_ref}</th><td>{row.pharmacy_code}</td><td><span className="c3-status-pill">{row.status}</span></td>
            <td>{formatTime(row.expected_by)}</td><td>{formatTime(row.arrived_at)}</td>
            <td>{row.confirmation_status ? `${row.confirmation_status} · ${formatTime(row.confirmed_at)}` : '—'}</td>
            <td>{row.canMarkArrived && canDo(session, 'delivery.markArrived') &&
              <button type="button" className="c3-secondary" disabled={arrive.pending}
                onClick={() => arrive.run(() => client.markArrived(row.id), `Delivery ${row.delivery_ref} marked as arrived.`, deliveries.reload)}>
                Mark arrived</button>}</td>
          </tr>)}</tbody>
        </table></div>}
      </ResourceState>
    </Section>}
  </div>;
}
