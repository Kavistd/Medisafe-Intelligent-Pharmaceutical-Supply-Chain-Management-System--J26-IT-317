/**
 * Client-side validators mirroring the live API rules (docs/component3/LIVE_API.md).
 * They give early feedback only: the server is authoritative and re-validates everything.
 * Each returns { ok, errors: { field: message }, body } where body is the API request body.
 */
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WALLET = /^0x[0-9a-fA-F]{40}$/;
const DAY_MS = 24 * 3600 * 1000;
export const ACTION_TYPES = Object.freeze(['ACKNOWLEDGE', 'IDENTIFY_STOCK', 'QUARANTINE', 'REPORT_QUANTITY', 'CLOSE']);
export const ITEM_RESULTS = Object.freeze(['COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE']);
export const CONFIRMATION_STATUSES = Object.freeze(['ACCEPTED', 'PARTIAL', 'REJECTED']);

const result = (errors, body) => ({ ok: Object.keys(errors).length === 0, errors, body });
const trimmed = value => (typeof value === 'string' ? value.trim() : '');
const validCode = value => CODE.test(value) && !WALLET.test(value);

/** Convert an <input type="datetime-local"> value (local time, no zone) to ISO 8601 UTC. */
export function localToIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function requiredText(errors, field, value, max, label) {
  const text = trimmed(value);
  if (!text) errors[field] = `${label} is required.`;
  else if (text.length > max) errors[field] = `${label} must be at most ${max} characters.`;
  return text;
}

function optionalText(errors, field, value, max, label) {
  const text = trimmed(value);
  if (text.length > max) errors[field] = `${label} must be at most ${max} characters.`;
  return text || undefined;
}

export function validateDeliveryForm({ pharmacyCode, expectedBy } = {}, now = new Date()) {
  const errors = {};
  if (!validCode(trimmed(pharmacyCode))) errors.pharmacyCode = 'Choose a pharmacy.';
  const iso = localToIso(expectedBy);
  if (!iso) errors.expectedBy = 'Enter the expected delivery date and time.';
  else if (Date.parse(iso) < now.getTime()) errors.expectedBy = 'The expected time cannot be in the past.';
  else if (Date.parse(iso) > now.getTime() + 90 * DAY_MS) errors.expectedBy = 'The expected time must be within 90 days.';
  return result(errors, { pharmacyCode: trimmed(pharmacyCode), expectedBy: iso });
}

export function validateConfirmation({ confirmationStatus, note } = {}) {
  const errors = {};
  if (!CONFIRMATION_STATUSES.includes(confirmationStatus)) errors.confirmationStatus = 'Choose accepted, partial or rejected.';
  const text = confirmationStatus === 'ACCEPTED'
    ? optionalText(errors, 'note', note, 1000, 'Note')
    : requiredText(errors, 'note', note, 1000, 'A note explaining the partial or rejected receipt');
  return result(errors, { confirmationStatus, ...(text ? { note: text } : {}) });
}

export function validateRecallCompletion({ note } = {}) {
  const errors = {};
  const text = optionalText(errors, 'note', note, 1000, 'Note');
  return result(errors, text ? { note: text } : {});
}

export function validateResolution({ note } = {}) {
  const errors = {};
  const text = requiredText(errors, 'note', note, 1000, 'A resolution note');
  return result(errors, { note: text });
}

export function validateRecallForm({ batchReference, reason, pharmacyCodes = [], actions = [] } = {}, now = new Date()) {
  const errors = {};
  const batch = requiredText(errors, 'batchReference', batchReference, 128, 'Batch reference');
  const why = requiredText(errors, 'reason', reason, 1000, 'Reason');
  const codes = [...new Set((Array.isArray(pharmacyCodes) ? pharmacyCodes : []).map(trimmed).filter(Boolean))];
  if (codes.length < 1 || codes.length > 50) errors.pharmacyCodes = 'Choose between 1 and 50 pharmacies.';
  else if (!codes.every(validCode)) errors.pharmacyCodes = 'A pharmacy code is invalid.';
  const chosen = (Array.isArray(actions) ? actions : []).filter(action => action && action.actionType);
  if (chosen.length < 1) errors.actions = 'Choose at least one required action.';
  const types = new Set();
  const body = [];
  for (const action of chosen) {
    if (!ACTION_TYPES.includes(action.actionType) || types.has(action.actionType)) { errors.actions = 'Each action type may be chosen once.'; continue; }
    types.add(action.actionType);
    const iso = localToIso(action.dueAt);
    if (!iso) { errors[`due_${action.actionType}`] = 'Enter a due date and time.'; continue; }
    if (Date.parse(iso) <= now.getTime() || Date.parse(iso) > now.getTime() + 365 * DAY_MS) {
      errors[`due_${action.actionType}`] = 'The due time must be in the future and within 365 days.';
      continue;
    }
    body.push({ actionType: action.actionType, dueAt: iso });
  }
  return result(errors, { batchReference: batch, reason: why, pharmacyCodes: codes, actions: body });
}

export function validateComplaintForm({ pharmacyCode, summary } = {}) {
  const errors = {};
  if (!validCode(trimmed(pharmacyCode))) errors.pharmacyCode = 'Choose a pharmacy.';
  const text = requiredText(errors, 'summary', summary, 2000, 'Summary');
  return result(errors, { pharmacyCode: trimmed(pharmacyCode), summary: text });
}

export function validateScreening({ outcome } = {}) {
  const errors = {};
  if (!['SUBSTANTIATED', 'UNSUBSTANTIATED'].includes(outcome)) errors.outcome = 'Choose substantiated or unsubstantiated.';
  return result(errors, { outcome });
}

export function validateInspectionForm({ pharmacyCode, inspectedAt, items = [] } = {}, now = new Date()) {
  const errors = {};
  if (!validCode(trimmed(pharmacyCode))) errors.pharmacyCode = 'Choose a pharmacy.';
  const iso = localToIso(inspectedAt);
  if (!iso) errors.inspectedAt = 'Enter the inspection date and time.';
  else if (Date.parse(iso) > now.getTime()) errors.inspectedAt = 'The inspection time cannot be in the future.';
  else if (Date.parse(iso) < now.getTime() - 365 * DAY_MS) errors.inspectedAt = 'The inspection must be within the past 365 days.';
  const chosen = (Array.isArray(items) ? items : []).filter(item => item && item.result);
  if (chosen.length < 1 || chosen.length > 50) errors.items = 'Record a result for at least one criterion.';
  const seen = new Set();
  const body = [];
  for (const item of chosen) {
    const code = trimmed(item.criterionCode);
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code) || seen.has(code)) { errors.items = 'Each criterion may be recorded once.'; continue; }
    seen.add(code);
    if (!ITEM_RESULTS.includes(item.result)) { errors[`item_${code}`] = 'Choose a valid result.'; continue; }
    const critical = item.critical === true;
    if (critical && item.result !== 'NON_COMPLIANT') { errors[`item_${code}`] = 'Only a non-compliant item can be critical.'; continue; }
    const note = optionalText(errors, `item_${code}`, item.note, 500, 'Note');
    body.push({ criterionCode: code, result: item.result, critical, ...(note ? { note } : {}) });
  }
  return result(errors, { pharmacyCode: trimmed(pharmacyCode), inspectedAt: iso, items: body });
}
