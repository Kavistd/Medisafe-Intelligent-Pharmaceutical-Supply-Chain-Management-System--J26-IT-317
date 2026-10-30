import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localToIso, validateComplaintForm, validateConfirmation, validateDeliveryForm, validateInspectionForm,
  validateRecallCompletion, validateRecallForm, validateResolution, validateScreening,
} from './validators.js';

const NOW = new Date('2026-10-02T12:00:00Z');
// datetime-local values are local time; build them from Date objects so tests pass in any timezone.
const local = date => {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const hoursFromNow = hours => local(new Date(NOW.getTime() + hours * 3600 * 1000));

test('datetime-local values become ISO 8601 UTC timestamps', () => {
  assert.equal(localToIso('2026-10-02T10:00'), new Date('2026-10-02T10:00').toISOString());
  for (const bad of ['', '2026-10-02', '10:00', 'tomorrow', null, 42]) assert.equal(localToIso(bad), null);
});

test('delivery form: pharmacy required, expected time between now and 90 days', () => {
  const good = validateDeliveryForm({ pharmacyCode: 'C3-PH-A', expectedBy: hoursFromNow(24) }, NOW);
  assert.equal(good.ok, true);
  assert.match(good.body.expectedBy, /Z$/);
  assert.deepEqual(Object.keys(good.body).sort(), ['expectedBy', 'pharmacyCode']);
  assert.ok(validateDeliveryForm({ pharmacyCode: '', expectedBy: hoursFromNow(24) }, NOW).errors.pharmacyCode);
  assert.ok(validateDeliveryForm({ pharmacyCode: '0x52908400098527886E0F7030069857D2E4169EE7', expectedBy: hoursFromNow(24) }, NOW).errors.pharmacyCode);
  assert.match(validateDeliveryForm({ pharmacyCode: 'C3-PH-A', expectedBy: hoursFromNow(-2) }, NOW).errors.expectedBy, /past/);
  assert.match(validateDeliveryForm({ pharmacyCode: 'C3-PH-A', expectedBy: hoursFromNow(24 * 91) }, NOW).errors.expectedBy, /90 days/);
});

test('confirmation: a note is required unless accepted', () => {
  assert.deepEqual(validateConfirmation({ confirmationStatus: 'ACCEPTED' }), { ok: true, errors: {}, body: { confirmationStatus: 'ACCEPTED' } });
  assert.ok(validateConfirmation({ confirmationStatus: 'PARTIAL', note: '  ' }).errors.note);
  assert.ok(validateConfirmation({ confirmationStatus: 'REJECTED' }).errors.note);
  assert.deepEqual(validateConfirmation({ confirmationStatus: 'REJECTED', note: ' Damaged ' }).body, { confirmationStatus: 'REJECTED', note: 'Damaged' });
  assert.ok(validateConfirmation({ confirmationStatus: 'MAYBE' }).errors.confirmationStatus);
  assert.ok(validateConfirmation({ confirmationStatus: 'ACCEPTED', note: 'x'.repeat(1001) }).errors.note);
});

test('recall completion and complaint resolution notes', () => {
  assert.deepEqual(validateRecallCompletion({}).body, {});
  assert.deepEqual(validateRecallCompletion({ note: 'Done' }).body, { note: 'Done' });
  assert.ok(validateResolution({ note: '' }).errors.note);
  assert.equal(validateResolution({ note: 'Refund issued' }).ok, true);
});

test('recall form: pharmacies, unique action types, due times in the future within 365 days', () => {
  const good = validateRecallForm({ batchReference: 'B-1', reason: 'Labelling', pharmacyCodes: ['C3-PH-A', 'C3-PH-A', 'C3-PH-B'],
    actions: [{ actionType: 'ACKNOWLEDGE', dueAt: hoursFromNow(24) }, { actionType: 'CLOSE', dueAt: hoursFromNow(72) }] }, NOW);
  assert.equal(good.ok, true);
  assert.deepEqual(good.body.pharmacyCodes, ['C3-PH-A', 'C3-PH-B']);
  assert.equal(good.body.actions.length, 2);
  const bad = validateRecallForm({ batchReference: '', reason: '', pharmacyCodes: [],
    actions: [{ actionType: 'CLOSE', dueAt: hoursFromNow(-1) }, { actionType: 'CLOSE', dueAt: hoursFromNow(5) }] }, NOW);
  assert.equal(bad.ok, false);
  for (const field of ['batchReference', 'reason', 'pharmacyCodes', 'due_CLOSE', 'actions']) assert.ok(bad.errors[field], field);
  assert.ok(validateRecallForm({ batchReference: 'B', reason: 'R', pharmacyCodes: ['C3-PH-A'], actions: [] }, NOW).errors.actions);
});

test('complaint and screening forms', () => {
  assert.equal(validateComplaintForm({ pharmacyCode: 'C3-PH-A', summary: 'Rude staff' }).ok, true);
  assert.ok(validateComplaintForm({ pharmacyCode: 'C3-PH-A', summary: 'x'.repeat(2001) }).errors.summary);
  assert.equal(validateScreening({ outcome: 'SUBSTANTIATED' }).ok, true);
  assert.ok(validateScreening({ outcome: 'MAYBE' }).errors.outcome);
});

test('inspection form: past time, results, critical only when non-compliant, unique criteria', () => {
  const good = validateInspectionForm({ pharmacyCode: 'C3-PH-A', inspectedAt: hoursFromNow(-3), items: [
    { criterionCode: 'LICENCE_DISPLAYED', result: 'COMPLIANT', critical: false },
    { criterionCode: 'CONTROLLED_MEDICINES_LOCKED', result: 'NON_COMPLIANT', critical: true, note: ' Unlocked ' },
    { criterionCode: 'VACCINE_STORAGE_LOG', result: '' },
  ] }, NOW);
  assert.equal(good.ok, true);
  assert.deepEqual(good.body.items, [
    { criterionCode: 'LICENCE_DISPLAYED', result: 'COMPLIANT', critical: false },
    { criterionCode: 'CONTROLLED_MEDICINES_LOCKED', result: 'NON_COMPLIANT', critical: true, note: 'Unlocked' },
  ]);
  assert.ok(validateInspectionForm({ pharmacyCode: 'C3-PH-A', inspectedAt: hoursFromNow(2), items: [{ criterionCode: 'A', result: 'COMPLIANT' }] }, NOW).errors.inspectedAt);
  assert.ok(validateInspectionForm({ pharmacyCode: 'C3-PH-A', inspectedAt: hoursFromNow(-3), items: [] }, NOW).errors.items);
  assert.ok(validateInspectionForm({ pharmacyCode: 'C3-PH-A', inspectedAt: hoursFromNow(-3),
    items: [{ criterionCode: 'LICENCE_DISPLAYED', result: 'COMPLIANT', critical: true }] }, NOW).errors.item_LICENCE_DISPLAYED);
});
