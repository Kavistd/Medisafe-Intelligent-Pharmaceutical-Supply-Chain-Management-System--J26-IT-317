-- Component 3 LIVE seed (TEMPLATE). Requires 001_c3_live_schema.sql. Design: docs/component3/LIVE_DESIGN.md
--
-- SIMULATED DATA ONLY. Every event row is evidence_class SEEDED_SIMULATED; none is real-world verified.
--
-- BEFORE RUNNING: create the four demo users manually in the Supabase dashboard (c3.regulator,
-- c3.pharmacy.a, c3.pharmacy.b, c3.distributor) and replace the four <<...>> placeholders below with
-- their user UUIDs. If a placeholder is left unchanged the guard block aborts the whole transaction.
--
-- Time anchor: all offsets are HOURS after 2026-08-01T00:00:00Z. Every deadline (delivery confirmation
-- window, recall due_at, complaint resolution due) falls before 2026-10-01T00:00:00Z, so any assessment
-- evaluated at or after that instant gives identical, reproducible results.
--
-- Expected results under policy v1 (proposed research parameters):
--   C3-PH-A  D = 7/10 = 70, R = 9/12 = 75, C = 4/6 = 66.67, I = 16/20 = 80
--            TS = 217/3 = 72.333 (exact); 72.334 when C is first rounded to 66.67, as in test T05.
--   C3-PH-B  D = 4/8 = 50, R = 3/8 = 37.5, C = 1/3 = 33.33, I = 6/12 = 50 -> TS = 42.917, plus a
--            critical inspection finding escalated separately from the score.
--   C3-PH-C  no recall actions at all -> R NOT_ASSESSABLE -> overall NOT_ASSESSABLE (never 100).

BEGIN;

-- Transaction-local settings: the audited actor, and the four demo auth user UUIDs.
SELECT set_config('c3.actor_role', 'SEED', true);
SELECT set_config('c3_seed.regulator_user_id', '<<REGULATOR_AUTH_USER_UUID>>', true);
SELECT set_config('c3_seed.pharmacy_a_user_id', '<<PHARMACY_A_AUTH_USER_UUID>>', true);
SELECT set_config('c3_seed.pharmacy_b_user_id', '<<PHARMACY_B_AUTH_USER_UUID>>', true);
SELECT set_config('c3_seed.distributor_user_id', '<<DISTRIBUTOR_AUTH_USER_UUID>>', true);

DO $guard$
DECLARE
  setting_name text;
BEGIN
  FOREACH setting_name IN ARRAY ARRAY['c3_seed.regulator_user_id', 'c3_seed.pharmacy_a_user_id',
                                      'c3_seed.pharmacy_b_user_id', 'c3_seed.distributor_user_id'] LOOP
    IF current_setting(setting_name) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'Seed template not filled in: replace the <<...>> placeholder for % with the demo user UUID', setting_name;
    END IF;
  END LOOP;
END
$guard$;

-- Entities -------------------------------------------------------------------------------------

INSERT INTO c3.pharmacies (pharmacy_code, display_name, evidence_class) VALUES
  ('C3-PH-A', 'Simulated Pharmacy A (prototype)', 'SEEDED_SIMULATED'),
  ('C3-PH-B', 'Simulated Pharmacy B (prototype)', 'SEEDED_SIMULATED'),
  ('C3-PH-C', 'Simulated Pharmacy C (prototype)', 'SEEDED_SIMULATED');

INSERT INTO c3.distributors (distributor_code, display_name, evidence_class) VALUES
  ('C3-DS-01', 'Simulated Distributor 01 (prototype)', 'SEEDED_SIMULATED');

-- Roles (assigned only by provisioning SQL) ----------------------------------------------------

INSERT INTO c3.user_roles (user_id, role, pharmacy_id, distributor_id, status)
SELECT current_setting('c3_seed.regulator_user_id')::uuid, 'REGULATOR', NULL, NULL, 'ACTIVE'
UNION ALL
SELECT current_setting('c3_seed.pharmacy_a_user_id')::uuid, 'PHARMACY_USER', p.id, NULL, 'ACTIVE'
FROM c3.pharmacies AS p WHERE p.pharmacy_code = 'C3-PH-A'
UNION ALL
SELECT current_setting('c3_seed.pharmacy_b_user_id')::uuid, 'PHARMACY_USER', p.id, NULL, 'ACTIVE'
FROM c3.pharmacies AS p WHERE p.pharmacy_code = 'C3-PH-B'
UNION ALL
SELECT current_setting('c3_seed.distributor_user_id')::uuid, 'DISTRIBUTOR', NULL, d.id, 'ACTIVE'
FROM c3.distributors AS d WHERE d.distributor_code = 'C3-DS-01';

-- D: deliveries ----------------------------------------------------------------------------------
-- (ref, pharmacy, dispatched_h, expected_h, arrived_h, confirmation, confirmed_h, note)
-- Success = confirmed within 24 h of arrival (inclusive). Distributor lateness (arrived > expected)
-- is recorded but is not a pharmacy failure. A delivery that has not arrived is never eligible.

INSERT INTO c3.deliveries (
  delivery_ref, distributor_id, pharmacy_id, policy_version, dispatched_at, expected_by, arrived_at,
  status, confirmation_status, confirmed_at, confirmation_note, evidence_class
)
SELECT v.delivery_ref, d.id, p.id, 'v1',
       a.t + v.dispatched_h * interval '1 hour',
       a.t + v.expected_h * interval '1 hour',
       a.t + v.arrived_h * interval '1 hour',
       CASE WHEN v.confirmed_h IS NOT NULL THEN 'CONFIRMED' WHEN v.arrived_h IS NOT NULL THEN 'ARRIVED' ELSE 'DISPATCHED' END,
       v.confirmation, a.t + v.confirmed_h * interval '1 hour', v.note, 'SEEDED_SIMULATED'
FROM (VALUES
-- @data deliveries begin
  ('C3-DL-A01', 'C3-PH-A', 0, 24, 20, 'ACCEPTED', 30, NULL),
  ('C3-DL-A02', 'C3-PH-A', 48, 72, 70, 'ACCEPTED', 80, NULL),
  ('C3-DL-A03', 'C3-PH-A', 96, 120, 130, 'ACCEPTED', 140, NULL),
  ('C3-DL-A04', 'C3-PH-A', 144, 168, 160, 'PARTIAL', 170, 'Two cartons short; reported to the distributor.'),
  ('C3-DL-A05', 'C3-PH-A', 192, 216, 210, 'ACCEPTED', 230, NULL),
  ('C3-DL-A06', 'C3-PH-A', 240, 264, 260, 'REJECTED', 270, 'Cold-chain indicator breached; consignment refused.'),
  ('C3-DL-A07', 'C3-PH-A', 288, 312, 300, 'ACCEPTED', 324, NULL),
  ('C3-DL-A08', 'C3-PH-A', 336, 360, 350, 'ACCEPTED', 380, NULL),
  ('C3-DL-A09', 'C3-PH-A', 384, 408, 400, NULL, NULL, NULL),
  ('C3-DL-A10', 'C3-PH-A', 432, 456, 450, 'PARTIAL', 490, 'Late check; one carton damaged.'),
  ('C3-DL-A11', 'C3-PH-A', 480, 504, NULL, NULL, NULL, NULL),
  ('C3-DL-B01', 'C3-PH-B', 0, 24, 22, 'ACCEPTED', 30, NULL),
  ('C3-DL-B02', 'C3-PH-B', 48, 72, 70, 'ACCEPTED', 100, NULL),
  ('C3-DL-B03', 'C3-PH-B', 96, 120, 118, 'ACCEPTED', 130, NULL),
  ('C3-DL-B04', 'C3-PH-B', 144, 168, 166, NULL, NULL, NULL),
  ('C3-DL-B05', 'C3-PH-B', 192, 216, 200, 'ACCEPTED', 260, NULL),
  ('C3-DL-B06', 'C3-PH-B', 240, 264, 250, 'PARTIAL', 260, 'Short by one carton.'),
  ('C3-DL-B07', 'C3-PH-B', 288, 312, 300, NULL, NULL, NULL),
  ('C3-DL-B08', 'C3-PH-B', 336, 360, 345, 'ACCEPTED', 350, NULL),
  ('C3-DL-C01', 'C3-PH-C', 0, 24, 20, 'ACCEPTED', 25, NULL),
  ('C3-DL-C02', 'C3-PH-C', 48, 72, 60, 'ACCEPTED', 70, NULL),
  ('C3-DL-C03', 'C3-PH-C', 96, 120, 100, 'ACCEPTED', 110, NULL),
  ('C3-DL-C04', 'C3-PH-C', 144, 168, 150, 'ACCEPTED', 160, NULL),
  ('C3-DL-C05', 'C3-PH-C', 192, 216, 200, 'ACCEPTED', 210, NULL)
-- @data deliveries end
) AS v(delivery_ref, pharmacy_code, dispatched_h, expected_h, arrived_h, confirmation, confirmed_h, note)
CROSS JOIN (SELECT timestamptz '2026-08-01 00:00:00+00' AS t) AS a
JOIN c3.pharmacies AS p ON p.pharmacy_code = v.pharmacy_code
JOIN c3.distributors AS d ON d.distributor_code = 'C3-DS-01';

-- R: recalls and recall actions ------------------------------------------------------------------
-- recalls: (ref, batch reference, reason, issued_h)

INSERT INTO c3.recalls (recall_ref, batch_reference, reason, issued_at, issued_by, status, evidence_class)
SELECT v.recall_ref, v.batch_reference, v.reason, a.t + v.issued_h * interval '1 hour',
       current_setting('c3_seed.regulator_user_id')::uuid, 'ACTIVE', 'SEEDED_SIMULATED'
FROM (VALUES
-- @data recalls begin
  ('C3-RC-001', 'SIM-BATCH-001', 'Simulated recall: labelling defect.', 0),
  ('C3-RC-002', 'SIM-BATCH-002', 'Simulated recall: potency out of specification.', 240),
  ('C3-RC-003', 'SIM-BATCH-003', 'Simulated recall: packaging integrity.', 480)
-- @data recalls end
) AS v(recall_ref, batch_reference, reason, issued_h)
CROSS JOIN (SELECT timestamptz '2026-08-01 00:00:00+00' AS t) AS a;

-- recall actions: (recall, pharmacy, action, due_h, completed_h). Success = completed_at <= due_at.

INSERT INTO c3.recall_actions (recall_id, pharmacy_id, action_type, due_at, status, completed_at, completion_note, evidence_class)
SELECT r.id, p.id, v.action_type, a.t + v.due_h * interval '1 hour',
       CASE WHEN v.completed_h IS NULL THEN 'OPEN' ELSE 'COMPLETED' END,
       a.t + v.completed_h * interval '1 hour',
       CASE WHEN v.completed_h IS NULL THEN NULL ELSE 'Simulated completion.' END,
       'SEEDED_SIMULATED'
FROM (VALUES
-- @data recall_actions begin
  ('C3-RC-001', 'C3-PH-A', 'ACKNOWLEDGE', 24, 10),
  ('C3-RC-001', 'C3-PH-A', 'IDENTIFY_STOCK', 48, 40),
  ('C3-RC-001', 'C3-PH-A', 'QUARANTINE', 72, 70),
  ('C3-RC-001', 'C3-PH-A', 'CLOSE', 168, 160),
  ('C3-RC-002', 'C3-PH-A', 'ACKNOWLEDGE', 264, 250),
  ('C3-RC-002', 'C3-PH-A', 'IDENTIFY_STOCK', 288, 300),
  ('C3-RC-002', 'C3-PH-A', 'QUARANTINE', 312, 310),
  ('C3-RC-002', 'C3-PH-A', 'CLOSE', 408, 400),
  ('C3-RC-003', 'C3-PH-A', 'ACKNOWLEDGE', 504, 490),
  ('C3-RC-003', 'C3-PH-A', 'QUARANTINE', 552, 540),
  ('C3-RC-003', 'C3-PH-A', 'REPORT_QUANTITY', 576, 600),
  ('C3-RC-003', 'C3-PH-A', 'CLOSE', 648, NULL),
  ('C3-RC-001', 'C3-PH-B', 'ACKNOWLEDGE', 24, 20),
  ('C3-RC-001', 'C3-PH-B', 'IDENTIFY_STOCK', 48, 60),
  ('C3-RC-001', 'C3-PH-B', 'QUARANTINE', 72, 100),
  ('C3-RC-001', 'C3-PH-B', 'CLOSE', 168, NULL),
  ('C3-RC-002', 'C3-PH-B', 'ACKNOWLEDGE', 264, 260),
  ('C3-RC-002', 'C3-PH-B', 'IDENTIFY_STOCK', 288, 280),
  ('C3-RC-002', 'C3-PH-B', 'QUARANTINE', 312, 330),
  ('C3-RC-002', 'C3-PH-B', 'CLOSE', 408, NULL)
-- @data recall_actions end
) AS v(recall_ref, pharmacy_code, action_type, due_h, completed_h)
CROSS JOIN (SELECT timestamptz '2026-08-01 00:00:00+00' AS t) AS a
JOIN c3.recalls AS r ON r.recall_ref = v.recall_ref
JOIN c3.pharmacies AS p ON p.pharmacy_code = v.pharmacy_code;

-- C: complaints ----------------------------------------------------------------------------------
-- (ref, pharmacy, logged_h, screening, screened_h, resolved_h). Resolution due = screened + 30 days
-- (set by the schema from policy v1). Unsubstantiated and unscreened complaints never count.

INSERT INTO c3.complaints (
  complaint_ref, pharmacy_id, policy_version, summary, logged_at, logged_by, status,
  screened_at, screened_by, resolved_at, resolution_note, evidence_class
)
SELECT v.complaint_ref, p.id, 'v1', 'Simulated complaint for the prototype.',
       a.t + v.logged_h * interval '1 hour',
       current_setting('c3_seed.regulator_user_id')::uuid,
       CASE WHEN v.screening IS NULL THEN 'LOGGED'
            WHEN v.screening = 'UNSUBSTANTIATED' THEN 'UNSUBSTANTIATED'
            WHEN v.resolved_h IS NOT NULL THEN 'RESOLVED'
            ELSE 'SUBSTANTIATED' END,
       a.t + v.screened_h * interval '1 hour',
       CASE WHEN v.screening IS NULL THEN NULL ELSE current_setting('c3_seed.regulator_user_id')::uuid END,
       a.t + v.resolved_h * interval '1 hour',
       CASE WHEN v.resolved_h IS NULL THEN NULL ELSE 'Simulated resolution note.' END,
       'SEEDED_SIMULATED'
FROM (VALUES
-- @data complaints begin
  ('C3-CP-A01', 'C3-PH-A', 0, 'SUBSTANTIATED', 24, 200),
  ('C3-CP-A02', 'C3-PH-A', 48, 'SUBSTANTIATED', 72, 400),
  ('C3-CP-A03', 'C3-PH-A', 96, 'SUBSTANTIATED', 120, 800),
  ('C3-CP-A04', 'C3-PH-A', 144, 'SUBSTANTIATED', 168, 880),
  ('C3-CP-A05', 'C3-PH-A', 192, 'SUBSTANTIATED', 216, 1000),
  ('C3-CP-A06', 'C3-PH-A', 240, 'SUBSTANTIATED', 264, NULL),
  ('C3-CP-A07', 'C3-PH-A', 288, 'UNSUBSTANTIATED', 300, NULL),
  ('C3-CP-A08', 'C3-PH-A', 336, 'UNSUBSTANTIATED', 350, NULL),
  ('C3-CP-A09', 'C3-PH-A', 384, NULL, NULL, NULL),
  ('C3-CP-B01', 'C3-PH-B', 0, 'SUBSTANTIATED', 24, 300),
  ('C3-CP-B02', 'C3-PH-B', 48, 'SUBSTANTIATED', 72, 900),
  ('C3-CP-B03', 'C3-PH-B', 96, 'SUBSTANTIATED', 120, NULL),
  ('C3-CP-B04', 'C3-PH-B', 144, 'UNSUBSTANTIATED', 160, NULL),
  ('C3-CP-C01', 'C3-PH-C', 0, 'SUBSTANTIATED', 24, 100),
  ('C3-CP-C02', 'C3-PH-C', 48, 'SUBSTANTIATED', 72, 200)
-- @data complaints end
) AS v(complaint_ref, pharmacy_code, logged_h, screening, screened_h, resolved_h)
CROSS JOIN (SELECT timestamptz '2026-08-01 00:00:00+00' AS t) AS a
JOIN c3.pharmacies AS p ON p.pharmacy_code = v.pharmacy_code;

-- I: inspections ---------------------------------------------------------------------------------
-- (ref, pharmacy, inspected_h, finalised_h). Created as DRAFT; finalised below so the schema raises
-- critical findings. Only the latest FINAL inspection counts; a DRAFT never counts.

INSERT INTO c3.inspections (inspection_ref, pharmacy_id, policy_version, inspected_at, recorded_by, status, evidence_class)
SELECT v.inspection_ref, p.id, 'v1', a.t + v.inspected_h * interval '1 hour',
       current_setting('c3_seed.regulator_user_id')::uuid, 'DRAFT', 'SEEDED_SIMULATED'
FROM (VALUES
-- @data inspections begin
  ('C3-IN-A01', 'C3-PH-A', 24, 30),
  ('C3-IN-A02', 'C3-PH-A', 600, 610),
  ('C3-IN-A03', 'C3-PH-A', 700, NULL),
  ('C3-IN-B01', 'C3-PH-B', 500, 510),
  ('C3-IN-C01', 'C3-PH-C', 400, 410)
-- @data inspections end
) AS v(inspection_ref, pharmacy_code, inspected_h, finalised_h)
CROSS JOIN (SELECT timestamptz '2026-08-01 00:00:00+00' AS t) AS a
JOIN c3.pharmacies AS p ON p.pharmacy_code = v.pharmacy_code;

-- inspection items: (inspection, criterion, result, critical). Points 1 / 0.5 / 0; N/A excluded.

INSERT INTO c3.inspection_items (inspection_id, criterion_code, result, critical, note, evidence_class)
SELECT s.id, v.criterion_code, v.result, v.critical,
       CASE WHEN v.result IN ('PARTIAL', 'NON_COMPLIANT') THEN 'Simulated inspection note.' END,
       'SEEDED_SIMULATED'
FROM (VALUES
-- @data inspection_items begin
  ('C3-IN-A01', 'LICENCE_DISPLAYED', 'COMPLIANT', false),
  ('C3-IN-A01', 'FRIDGE_TEMPERATURE_RECORD', 'NON_COMPLIANT', false),
  ('C3-IN-A01', 'CONTROLLED_MEDICINES_LOCKED', 'COMPLIANT', false),
  ('C3-IN-A01', 'COMPLAINT_REGISTER_MAINTAINED', 'NON_COMPLIANT', false),
  ('C3-IN-A02', 'LICENCE_DISPLAYED', 'COMPLIANT', false),
  ('C3-IN-A02', 'PHARMACIST_REGISTRATION_DISPLAYED', 'COMPLIANT', false),
  ('C3-IN-A02', 'PHARMACIST_ON_DUTY', 'COMPLIANT', false),
  ('C3-IN-A02', 'PREMISES_CLEAN_AND_SECURE', 'COMPLIANT', false),
  ('C3-IN-A02', 'STORAGE_TEMPERATURE_RECORD', 'COMPLIANT', false),
  ('C3-IN-A02', 'FRIDGE_TEMPERATURE_RECORD', 'COMPLIANT', false),
  ('C3-IN-A02', 'FRIDGE_DEDICATED_TO_MEDICINES', 'PARTIAL', false),
  ('C3-IN-A02', 'CONTROLLED_MEDICINES_LOCKED', 'COMPLIANT', false),
  ('C3-IN-A02', 'CONTROLLED_MEDICINES_REGISTER', 'COMPLIANT', false),
  ('C3-IN-A02', 'PURCHASE_INVOICES_AVAILABLE', 'COMPLIANT', false),
  ('C3-IN-A02', 'DISPENSING_RECORDS_MAINTAINED', 'COMPLIANT', false),
  ('C3-IN-A02', 'PRESCRIPTIONS_RETAINED', 'PARTIAL', false),
  ('C3-IN-A02', 'EXPIRED_STOCK_SEGREGATED', 'COMPLIANT', false),
  ('C3-IN-A02', 'RECALL_QUARANTINE_SEGREGATION', 'COMPLIANT', false),
  ('C3-IN-A02', 'RECALL_PROCEDURE_DOCUMENTED', 'COMPLIANT', false),
  ('C3-IN-A02', 'COMPLAINT_REGISTER_MAINTAINED', 'COMPLIANT', false),
  ('C3-IN-A02', 'SELF_AUDIT_COMPLETED', 'PARTIAL', false),
  ('C3-IN-A02', 'STAFF_TRAINING_RECORDS', 'PARTIAL', false),
  ('C3-IN-A02', 'PEST_CONTROL_RECORD', 'NON_COMPLIANT', false),
  ('C3-IN-A02', 'LABELLING_AND_PACKAGING', 'NON_COMPLIANT', false),
  ('C3-IN-A02', 'COMPOUNDING_AREA_STANDARDS', 'NOT_APPLICABLE', false),
  ('C3-IN-A02', 'VACCINE_STORAGE_LOG', 'NOT_APPLICABLE', false),
  ('C3-IN-A03', 'LICENCE_DISPLAYED', 'NON_COMPLIANT', true),
  ('C3-IN-A03', 'PHARMACIST_ON_DUTY', 'COMPLIANT', false),
  ('C3-IN-B01', 'LICENCE_DISPLAYED', 'COMPLIANT', false),
  ('C3-IN-B01', 'PHARMACIST_REGISTRATION_DISPLAYED', 'COMPLIANT', false),
  ('C3-IN-B01', 'PREMISES_CLEAN_AND_SECURE', 'COMPLIANT', false),
  ('C3-IN-B01', 'PURCHASE_INVOICES_AVAILABLE', 'COMPLIANT', false),
  ('C3-IN-B01', 'EXPIRED_STOCK_SEGREGATED', 'COMPLIANT', false),
  ('C3-IN-B01', 'STORAGE_TEMPERATURE_RECORD', 'PARTIAL', false),
  ('C3-IN-B01', 'DISPENSING_RECORDS_MAINTAINED', 'PARTIAL', false),
  ('C3-IN-B01', 'FRIDGE_TEMPERATURE_RECORD', 'NON_COMPLIANT', false),
  ('C3-IN-B01', 'CONTROLLED_MEDICINES_LOCKED', 'NON_COMPLIANT', true),
  ('C3-IN-B01', 'CONTROLLED_MEDICINES_REGISTER', 'NON_COMPLIANT', false),
  ('C3-IN-B01', 'RECALL_QUARANTINE_SEGREGATION', 'NON_COMPLIANT', false),
  ('C3-IN-B01', 'COMPLAINT_REGISTER_MAINTAINED', 'NON_COMPLIANT', false),
  ('C3-IN-C01', 'LICENCE_DISPLAYED', 'COMPLIANT', false),
  ('C3-IN-C01', 'PHARMACIST_REGISTRATION_DISPLAYED', 'COMPLIANT', false),
  ('C3-IN-C01', 'PHARMACIST_ON_DUTY', 'COMPLIANT', false),
  ('C3-IN-C01', 'PREMISES_CLEAN_AND_SECURE', 'COMPLIANT', false),
  ('C3-IN-C01', 'STORAGE_TEMPERATURE_RECORD', 'COMPLIANT', false),
  ('C3-IN-C01', 'FRIDGE_TEMPERATURE_RECORD', 'COMPLIANT', false),
  ('C3-IN-C01', 'CONTROLLED_MEDICINES_LOCKED', 'COMPLIANT', false),
  ('C3-IN-C01', 'CONTROLLED_MEDICINES_REGISTER', 'COMPLIANT', false),
  ('C3-IN-C01', 'PURCHASE_INVOICES_AVAILABLE', 'COMPLIANT', false),
  ('C3-IN-C01', 'EXPIRED_STOCK_SEGREGATED', 'COMPLIANT', false)
-- @data inspection_items end
) AS v(inspection_ref, criterion_code, result, critical)
JOIN c3.inspections AS s ON s.inspection_ref = v.inspection_ref;

-- Finalise (DRAFT -> FINAL). C3-IN-A03 stays DRAFT, so its critical item raises nothing.
UPDATE c3.inspections AS s
SET status = 'FINAL',
    finalised_at = timestamptz '2026-08-01 00:00:00+00' + v.finalised_h * interval '1 hour',
    finalised_by = current_setting('c3_seed.regulator_user_id')::uuid
FROM (VALUES
  ('C3-IN-A01', 30),
  ('C3-IN-A02', 610),
  ('C3-IN-B01', 510),
  ('C3-IN-C01', 410)
) AS v(inspection_ref, finalised_h)
WHERE s.inspection_ref = v.inspection_ref;

COMMIT;
