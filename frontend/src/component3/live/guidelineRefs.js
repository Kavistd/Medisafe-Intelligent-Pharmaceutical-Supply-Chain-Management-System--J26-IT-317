/**
 * Section-level NMRA guideline references for each indicator ("Basis" chips). Plain data and
 * pure helpers only. These point to where a topic is addressed; they are NOT a clause-by-clause
 * mapping (the inspection criterion mapping to GL-013/GL-014/GL-033 is still unverified), and the
 * scoring rules, weights, windows and tier thresholds are not taken from these documents.
 */
export const PROPOSED_PARAMETERS_LABEL = 'Section-level reference. Weights, time windows and tier thresholds are proposed research parameters, not NMRA values.';

export const GUIDELINE_TITLES = Object.freeze({
  'GL-013': 'Good Distribution Practice (GDP)',
  'GL-014': 'Good Pharmacy Practice (GPP)',
  'GL-015': 'Good Storage Practice (GSP)',
  'GL-033': 'NMRA guideline GL-033',
});

const ref = (code, page, section, note) => Object.freeze({ code, title: GUIDELINE_TITLES[code], page, section, note });

export const GUIDELINE_REFS = Object.freeze({
  delivery: Object.freeze([
    ref('GL-013', 'p.12', 's13(b)', 'Section cited for receipt of deliveries.'),
    ref('GL-013', 'p.19-22', 'Receiving', 'Receiving pages.'),
    ref('GL-015', 'p.11', 's11', 'Receipt of incoming materials.'),
    ref('GL-014', 'p.8', 's5.1', 'Section cited for delivery receipt at the pharmacy.'),
  ]),
  recall: Object.freeze([
    ref('GL-014', 'p.7', 's4.10', 'Medicine recall policy.'),
    ref('GL-013', 'p.11', 's11', 'Refers to the separate NMRA Recall Procedure guideline.'),
    ref('GL-015', 'p.15', 's17', 'Refers to the separate NMRA Recall Procedure guideline.'),
  ]),
  complaint: Object.freeze([
    ref('GL-013', 'p.8-10', 's9', 'Complaints.'),
    ref('GL-014', 'p.7', 's4.9', 'Complaints policy.'),
  ]),
  inspection: Object.freeze([
    ref('GL-013', 'p.26', 's28', 'Regulatory inspections.'),
    ref('GL-015', 'p.15', 's19', 'Regulatory inspections, risk-categorised observations and CAPA.'),
    ref('GL-033', 'p.5', 's1', 'Section cited for inspections.'),
  ]),
});

/** Critical escalation basis (controlled medicines kept locked). */
export const CRITICAL_ESCALATION_REFS = Object.freeze([
  ref('GL-033', 'p.8', 's4.3(iii)(b)', 'Controlled medicines kept locked.'),
  ref('GL-033', 'p.16', 's7', 'Section cited for the controlled-medicines escalation.'),
]);

/** Prototype parameters that these guidelines do not state. */
export const NOT_STATED_IN_GUIDELINES = Object.freeze([
  'The 24-hour delivery confirmation window is not stated in these guidelines; it is a proposed research parameter.',
  'The 30-day complaint resolution target is not stated in these guidelines; it is a proposed research parameter.',
]);

export function refsFor(key) {
  return key === 'criticalEscalation' ? CRITICAL_ESCALATION_REFS : GUIDELINE_REFS[key] || [];
}

/** Short chip text, e.g. "GL-013 p.8-10 s9". */
export function chipText(entry) {
  return `${entry.code} ${entry.page} ${entry.section}`;
}
