'use strict';

const INDICATORS = Object.freeze({
  DELIVERY: 'delivery',
  RECALL: 'recall',
  COMPLAINT: 'complaint',
  INSPECTION: 'inspection',
});

const SQL = Object.freeze({
  pharmacy: `
    SELECT id, pharmacy_code
    FROM pharmacy_trust.pharmacies
    WHERE pharmacy_code = $1
    LIMIT 1`,
  assessment: `
    SELECT id, critical_escalation_required, evidence_source
    FROM pharmacy_trust.trust_assessments
    WHERE pharmacy_id = $1
    ORDER BY assessed_at DESC, created_at DESC, id DESC
    LIMIT 1`,
  indicators: `
    SELECT indicator_type
    FROM pharmacy_trust.indicator_scores
    WHERE assessment_id = $1
    ORDER BY indicator_type`,
  evidence: `
    SELECT e.id AS evidence_id, e.pharmacy_id, e.indicator_type, e.event_type,
           e.source_type, e.source_system, e.source_reference, e.event_timestamp
    FROM pharmacy_trust.assessment_evidence AS ae
    JOIN pharmacy_trust.evidence AS e ON e.id = ae.evidence_id
    WHERE ae.assessment_id = $1 AND e.pharmacy_id = $2
    ORDER BY e.indicator_type, e.id`,
});

const NO_SCORE_REASON = 'No approved scoring-policy source or reproducible indicator inputs are stored; persisted indicator and aggregate scores are ignored.';

function rowsOf(result, label) {
  if (!result || !Array.isArray(result.rows)) {
    throw new Error(`PostgreSQL ${label} query returned an invalid result.`);
  }
  return result.rows;
}

function normalizeIndicator(value) {
  return INDICATORS[value] || null;
}

function evidenceProvenance(sourceType) {
  if (sourceType === 'SYNTHETIC') return 'SYNTHETIC';
  if (sourceType === 'DECLARED_REAL') return 'DECLARED_REAL';
  // VERIFIED_REAL and ON_CHAIN_VERIFIED are database labels, not independent verification here.
  return 'UNKNOWN';
}

function timestampString(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);
  return value;
}

function mapEvidence(row, pharmacyCode) {
  const indicator = normalizeIndicator(row.indicator_type);
  if (!indicator) return null;
  const mapped = {
    evidenceId: String(row.evidence_id),
    pharmacyId: pharmacyCode,
    indicator,
    eventType: row.event_type,
    source: { system: row.source_system },
    provenance: evidenceProvenance(row.source_type),
  };
  if (row.source_reference !== null && row.source_reference !== undefined) {
    mapped.source.reference = row.source_reference;
  }
  if (row.event_timestamp !== null && row.event_timestamp !== undefined) {
    mapped.eventTimestamp = timestampString(row.event_timestamp);
  }
  return mapped;
}

function createIndicatorAssessments(assessment, indicatorRows, evidenceRows) {
  const observedTypes = new Set(indicatorRows.map(row => normalizeIndicator(row.indicator_type)).filter(Boolean));
  const idsByIndicator = new Map(Object.values(INDICATORS).map(name => [name, new Set()]));
  for (const row of evidenceRows) {
    const indicator = normalizeIndicator(row.indicator_type);
    if (indicator && row.evidence_id !== null && row.evidence_id !== undefined) {
      idsByIndicator.get(indicator).add(String(row.evidence_id));
    }
  }

  // This label is carried only as declared provenance. It never makes an indicator assessable.
  const source = assessment.evidence_source === 'SYNTHETIC' ? 'SYNTHETIC' : 'REAL';
  return Object.fromEntries(Object.values(INDICATORS).map(name => [name, {
    indicator: { status: 'NOT_ASSESSABLE', evidenceCount: 0, source },
    reason: `${NO_SCORE_REASON}${observedTypes.has(name) ? '' : ' No indicator-score row exists.'}`,
    policyId: null,
    evidenceIds: [...idsByIndicator.get(name)],
  }]));
}

function createPostgresAssessmentRepository({ pool } = {}) {
  if (!pool || (typeof pool.query !== 'function' && typeof pool.connect !== 'function')) {
    throw new Error('A PostgreSQL pool with a query or connect function is required.');
  }

  async function readPharmacyAssessment(pharmacyId) {
    if (typeof pharmacyId !== 'string' || pharmacyId.length === 0) {
      throw new Error('pharmacyId must be a non-empty string.');
    }

    const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
    const ownsClient = client !== pool;
    let transactionStarted = false;
    try {
      if (ownsClient) {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        transactionStarted = true;
      }

      const pharmacyRows = rowsOf(await client.query(SQL.pharmacy, [pharmacyId]), 'pharmacy');
      const pharmacy = pharmacyRows[0];
      if (!pharmacy) {
        if (transactionStarted) await client.query('COMMIT');
        return null;
      }

      const assessmentRows = rowsOf(await client.query(SQL.assessment, [pharmacy.id]), 'assessment');
      const assessment = assessmentRows[0];
      if (!assessment) {
        if (transactionStarted) await client.query('COMMIT');
        return null;
      }
      if (typeof assessment.critical_escalation_required !== 'boolean') {
        throw new Error('PostgreSQL assessment has an invalid critical escalation flag.');
      }

      const indicatorRows = rowsOf(await client.query(SQL.indicators, [assessment.id]), 'indicator scores');
      const evidenceRows = rowsOf(await client.query(SQL.evidence, [assessment.id, pharmacy.id]), 'assessment evidence');
      const evidence = evidenceRows.map(row => mapEvidence(row, pharmacy.pharmacy_code)).filter(Boolean);
      const record = {
        pharmacyId: pharmacy.pharmacy_code,
        assessments: createIndicatorAssessments(assessment, indicatorRows, evidenceRows),
        evidence,
        criticalFindings: [],
        criticalEscalationRequired: assessment.critical_escalation_required,
      };

      if (transactionStarted) await client.query('COMMIT');
      return record;
    } catch (error) {
      if (transactionStarted) {
        try { await client.query('ROLLBACK'); } catch { /* Keep the original read failure. */ }
      }
      throw error;
    } finally {
      if (ownsClient && typeof client.release === 'function') client.release();
    }
  }

  return Object.freeze({ readPharmacyAssessment });
}

module.exports = { createPostgresAssessmentRepository };
