-- Component 3 LIVE schema (c3). Design source of truth: docs/component3/LIVE_DESIGN.md
--
-- Strictly additive and contained:
--   * creates objects ONLY inside the new schema c3;
--   * the only reference outside c3 is the foreign key c3.user_roles.user_id -> auth.users(id);
--   * creates/alters no role, extension, default privilege, publication, auth setting or object in
--     any other schema, and drops nothing.
-- Fails loudly on a partial or conflicting state (plain CREATE, no IF NOT EXISTS). Run once, as the
-- project owner, in a single transaction. Do NOT add c3 to the exposed API schemas.
--
-- Research prototype: every policy parameter below is a PROPOSED research parameter, not an NMRA
-- value. Scores are decision support, not a regulatory determination.

BEGIN;

CREATE SCHEMA c3;
COMMENT ON SCHEMA c3 IS 'Component 3 live prototype (pharmacy trust). Backend-only access; deny by default.';

-- ---------------------------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION c3.changed_columns(old_row jsonb, new_row jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
  FROM (SELECT jsonb_object_keys(old_row || new_row) AS k) AS keys
  WHERE (old_row -> k) IS DISTINCT FROM (new_row -> k)
$$;

CREATE FUNCTION c3.assert_transition(label text, old_row jsonb, new_row jsonb, allowed text[]) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  extra text[];
BEGIN
  SELECT array_agg(c ORDER BY c) INTO extra
  FROM unnest(c3.changed_columns(old_row, new_row)) AS c
  WHERE NOT (c = ANY (allowed));
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION '% update changes protected columns: % (records are forward-only)', label, array_to_string(extra, ', ');
  END IF;
END $$;

CREATE FUNCTION c3.current_actor_role() RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NULLIF(current_setting('c3.actor_role', true), '')
$$;

CREATE FUNCTION c3.current_actor_user_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NULLIF(current_setting('c3.actor_user_id', true), '')::uuid
$$;

CREATE FUNCTION c3.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'c3.% is append-only or forward-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END $$;

-- Only the listed columns may change on UPDATE (allowed columns passed as trigger arguments).
CREATE FUNCTION c3.guard_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM c3.assert_transition('c3.' || TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW), TG_ARGV);
  RETURN NEW;
END $$;

-- Evidence class must match the writer: SEED -> SEEDED_SIMULATED; any role user -> PROTOTYPE_ENTRY.
CREATE FUNCTION c3.enforce_evidence_class() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  actor text := c3.current_actor_role();
  expected text;
BEGIN
  expected := CASE actor
    WHEN 'SEED' THEN 'SEEDED_SIMULATED'
    WHEN 'REGULATOR' THEN 'PROTOTYPE_ENTRY'
    WHEN 'PHARMACY_USER' THEN 'PROTOTYPE_ENTRY'
    WHEN 'DISTRIBUTOR' THEN 'PROTOTYPE_ENTRY'
    WHEN 'PROVISIONING' THEN 'PROTOTYPE_ENTRY'
  END;
  IF expected IS NULL THEN
    RAISE EXCEPTION 'c3 writes require the c3.actor_role setting (SEED, PROVISIONING, REGULATOR, PHARMACY_USER or DISTRIBUTOR)';
  END IF;
  IF NEW.evidence_class IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'c3.% evidence_class must be % for actor role %', TG_TABLE_NAME, expected, actor;
  END IF;
  RETURN NEW;
END $$;

-- Role users must create records in their initial lifecycle state; only the seed may insert history.
CREATE FUNCTION c3.require_initial_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF c3.current_actor_role() IS DISTINCT FROM 'SEED' AND NEW.status IS DISTINCT FROM TG_ARGV[0] THEN
    RAISE EXCEPTION 'c3.% must be created with status %', TG_TABLE_NAME, TG_ARGV[0];
  END IF;
  RETURN NEW;
END $$;

-- Every write is audited with the actor taken from the transaction-local c3.actor_* settings.
CREATE FUNCTION c3.write_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  actor text := c3.current_actor_role();
  row_data jsonb;
  changed jsonb := NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    changed := to_jsonb(c3.changed_columns(to_jsonb(OLD), to_jsonb(NEW)));
  END IF;
  IF actor IS NULL THEN
    -- Deleting an auth user cascades to c3.user_roles outside any backend context.
    IF TG_TABLE_NAME = 'user_roles' AND TG_OP = 'DELETE' THEN
      actor := 'UNSPECIFIED';
    ELSE
      RAISE EXCEPTION 'c3 writes require the c3.actor_role setting; no unattributed writes are allowed';
    END IF;
  END IF;
  INSERT INTO c3.audit_log (actor_user_id, actor_role, action, target_table, target_id, details)
  VALUES (
    c3.current_actor_user_id(), actor, TG_OP, TG_TABLE_NAME, row_data ->> 'id',
    jsonb_strip_nulls(jsonb_build_object('status', row_data ->> 'status', 'role', row_data ->> 'role', 'changed', changed))
  );
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Reference data: policy (versioned, append-only) and the prototype inspection checklist
-- ---------------------------------------------------------------------------------------------

CREATE TABLE c3.policy (
  version text PRIMARY KEY CHECK (version ~ '^v[0-9]+$'),
  parameter_status text NOT NULL CHECK (parameter_status = 'PROPOSED_RESEARCH_PARAMETERS'),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  weight_delivery numeric(5,4) NOT NULL CHECK (weight_delivery > 0),
  weight_recall numeric(5,4) NOT NULL CHECK (weight_recall > 0),
  weight_complaint numeric(5,4) NOT NULL CHECK (weight_complaint > 0),
  weight_inspection numeric(5,4) NOT NULL CHECK (weight_inspection > 0),
  tier_highly_trusted_min numeric(6,3) NOT NULL,
  tier_trusted_min numeric(6,3) NOT NULL,
  tier_under_review_min numeric(6,3) NOT NULL,
  delivery_confirm_window_hours integer NOT NULL CHECK (delivery_confirm_window_hours > 0),
  complaint_resolution_target_days integer NOT NULL CHECK (complaint_resolution_target_days > 0),
  inspection_points_compliant numeric(3,2) NOT NULL,
  inspection_points_partial numeric(3,2) NOT NULL,
  inspection_points_non_compliant numeric(3,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT c3_policy_weights_sum_to_one CHECK (weight_delivery + weight_recall + weight_complaint + weight_inspection = 1),
  CONSTRAINT c3_policy_tier_order CHECK (0 < tier_under_review_min AND tier_under_review_min < tier_trusted_min
    AND tier_trusted_min < tier_highly_trusted_min AND tier_highly_trusted_min <= 100),
  CONSTRAINT c3_policy_point_order CHECK (inspection_points_non_compliant = 0
    AND inspection_points_non_compliant < inspection_points_partial
    AND inspection_points_partial < inspection_points_compliant AND inspection_points_compliant = 1)
);

INSERT INTO c3.policy (
  version, parameter_status, description,
  weight_delivery, weight_recall, weight_complaint, weight_inspection,
  tier_highly_trusted_min, tier_trusted_min, tier_under_review_min,
  delivery_confirm_window_hours, complaint_resolution_target_days,
  inspection_points_compliant, inspection_points_partial, inspection_points_non_compliant
) VALUES (
  'v1', 'PROPOSED_RESEARCH_PARAMETERS', 'Proposed research parameters for the Component 3 prototype; not NMRA values.',
  0.35, 0.30, 0.20, 0.15,
  80, 60, 40,
  24, 30,
  1, 0.5, 0
);

CREATE TABLE c3.inspection_criteria (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  mapping_status text NOT NULL CHECK (mapping_status = 'UNVERIFIED'),
  mapping_note text NOT NULL
);

INSERT INTO c3.inspection_criteria (code, display_order, title, mapping_status, mapping_note)
SELECT v.code, v.display_order, v.title, 'UNVERIFIED',
       'Prototype checklist; clause mapping to GL-013/GL-014/GL-033 still to be verified.'
FROM (VALUES
  ('LICENCE_DISPLAYED', 1, 'Pharmacy licence displayed'),
  ('PHARMACIST_REGISTRATION_DISPLAYED', 2, 'Pharmacist registration displayed'),
  ('PHARMACIST_ON_DUTY', 3, 'Registered pharmacist on duty'),
  ('PREMISES_CLEAN_AND_SECURE', 4, 'Premises clean and secure'),
  ('STORAGE_TEMPERATURE_RECORD', 5, 'Storage area temperature record'),
  ('FRIDGE_TEMPERATURE_RECORD', 6, 'Refrigerator temperature record'),
  ('FRIDGE_DEDICATED_TO_MEDICINES', 7, 'Refrigerator dedicated to medicines'),
  ('CONTROLLED_MEDICINES_LOCKED', 8, 'Controlled medicines locked'),
  ('CONTROLLED_MEDICINES_REGISTER', 9, 'Controlled medicines register maintained'),
  ('PURCHASE_INVOICES_AVAILABLE', 10, 'Registers and purchase invoices available'),
  ('DISPENSING_RECORDS_MAINTAINED', 11, 'Dispensing records maintained'),
  ('PRESCRIPTIONS_RETAINED', 12, 'Prescriptions retained'),
  ('EXPIRED_STOCK_SEGREGATED', 13, 'Expired stock segregated'),
  ('RECALL_QUARANTINE_SEGREGATION', 14, 'Recall and quarantine segregation'),
  ('RECALL_PROCEDURE_DOCUMENTED', 15, 'Recall procedure documented'),
  ('COMPLAINT_REGISTER_MAINTAINED', 16, 'Complaint register maintained'),
  ('SELF_AUDIT_COMPLETED', 17, 'Self-audit completed'),
  ('STAFF_TRAINING_RECORDS', 18, 'Staff training records'),
  ('PEST_CONTROL_RECORD', 19, 'Pest control record'),
  ('LABELLING_AND_PACKAGING', 20, 'Dispensing labelling and packaging'),
  ('COMPOUNDING_AREA_STANDARDS', 21, 'Compounding area standards (where applicable)'),
  ('VACCINE_STORAGE_LOG', 22, 'Vaccine storage log (where applicable)')
) AS v(code, display_order, title);

-- ---------------------------------------------------------------------------------------------
-- Entities and roles
-- ---------------------------------------------------------------------------------------------

CREATE TABLE c3.pharmacies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_code text NOT NULL UNIQUE CHECK (pharmacy_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    AND pharmacy_code !~ '^0x[0-9a-fA-F]{40}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE c3.distributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_code text NOT NULL UNIQUE CHECK (distributor_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Roles are assigned only by provisioning SQL. No ACTIVE row = no access (deny by default).
CREATE TABLE c3.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('REGULATOR', 'PHARMACY_USER', 'DISTRIBUTOR')),
  pharmacy_id uuid REFERENCES c3.pharmacies(id) ON DELETE RESTRICT,
  distributor_id uuid REFERENCES c3.distributors(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT c3_user_roles_pharmacy_scope CHECK ((role = 'PHARMACY_USER') = (pharmacy_id IS NOT NULL)),
  CONSTRAINT c3_user_roles_distributor_scope CHECK ((role = 'DISTRIBUTOR') = (distributor_id IS NOT NULL))
);
CREATE UNIQUE INDEX c3_user_roles_one_active_role ON c3.user_roles (user_id) WHERE status = 'ACTIVE';
CREATE INDEX c3_user_roles_pharmacy ON c3.user_roles (pharmacy_id);
CREATE INDEX c3_user_roles_distributor ON c3.user_roles (distributor_id);

-- ---------------------------------------------------------------------------------------------
-- D: deliveries (distributor dispatches/arrives; pharmacy confirms within the policy window)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE c3.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_ref text NOT NULL UNIQUE CHECK (length(btrim(delivery_ref)) > 0),
  distributor_id uuid NOT NULL REFERENCES c3.distributors(id),
  pharmacy_id uuid NOT NULL REFERENCES c3.pharmacies(id),
  policy_version text NOT NULL REFERENCES c3.policy(version),
  dispatched_at timestamptz NOT NULL,
  expected_by timestamptz NOT NULL,
  arrived_at timestamptz,
  confirm_due_at timestamptz,
  status text NOT NULL CHECK (status IN ('DISPATCHED', 'ARRIVED', 'CONFIRMED')),
  confirmation_status text CHECK (confirmation_status IN ('ACCEPTED', 'PARTIAL', 'REJECTED')),
  confirmed_at timestamptz,
  confirmation_note text,
  created_by uuid,
  arrived_marked_by uuid,
  confirmed_by uuid,
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT c3_deliveries_expected_after_dispatch CHECK (expected_by >= dispatched_at),
  CONSTRAINT c3_deliveries_arrival_after_dispatch CHECK (arrived_at IS NULL OR arrived_at >= dispatched_at),
  CONSTRAINT c3_deliveries_confirm_after_arrival CHECK (confirmed_at IS NULL OR (arrived_at IS NOT NULL AND confirmed_at >= arrived_at)),
  CONSTRAINT c3_deliveries_confirm_due_with_arrival CHECK ((arrived_at IS NULL) = (confirm_due_at IS NULL)),
  CONSTRAINT c3_deliveries_status_consistency CHECK (
    (status = 'DISPATCHED' AND arrived_at IS NULL AND confirmed_at IS NULL AND confirmation_status IS NULL AND confirmation_note IS NULL)
    OR (status = 'ARRIVED' AND arrived_at IS NOT NULL AND confirmed_at IS NULL AND confirmation_status IS NULL AND confirmation_note IS NULL)
    OR (status = 'CONFIRMED' AND arrived_at IS NOT NULL AND confirmed_at IS NOT NULL AND confirmation_status IS NOT NULL)),
  CONSTRAINT c3_deliveries_note_when_not_accepted CHECK (confirmation_status IS NULL OR confirmation_status = 'ACCEPTED'
    OR length(btrim(COALESCE(confirmation_note, ''))) > 0)
);
CREATE INDEX c3_deliveries_pharmacy ON c3.deliveries (pharmacy_id, arrived_at);
CREATE INDEX c3_deliveries_distributor ON c3.deliveries (distributor_id);

CREATE FUNCTION c3.derive_delivery() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  window_hours integer;
BEGIN
  IF NEW.arrived_at IS NULL THEN
    NEW.confirm_due_at := NULL;
  ELSE
    SELECT p.delivery_confirm_window_hours INTO window_hours FROM c3.policy AS p WHERE p.version = NEW.policy_version;
    NEW.confirm_due_at := NEW.arrived_at + make_interval(hours => window_hours);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION c3.guard_delivery() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'DISPATCHED' AND NEW.status = 'ARRIVED' THEN
    PERFORM c3.assert_transition('c3.deliveries', to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['status', 'arrived_at', 'confirm_due_at', 'arrived_marked_by']);
  ELSIF OLD.status = 'ARRIVED' AND NEW.status = 'CONFIRMED' THEN
    PERFORM c3.assert_transition('c3.deliveries', to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['status', 'confirmation_status', 'confirmed_at', 'confirmation_note', 'confirmed_by']);
  ELSE
    RAISE EXCEPTION 'c3.deliveries transition % -> % is not permitted (forward-only)', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- R: recalls and per-pharmacy recall actions
-- ---------------------------------------------------------------------------------------------

CREATE TABLE c3.recalls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recall_ref text NOT NULL UNIQUE CHECK (length(btrim(recall_ref)) > 0),
  batch_reference text NOT NULL CHECK (length(btrim(batch_reference)) > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  issued_at timestamptz NOT NULL,
  issued_by uuid,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
  closed_at timestamptz,
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT c3_recalls_closed_consistency CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CONSTRAINT c3_recalls_closed_after_issue CHECK (closed_at IS NULL OR closed_at >= issued_at)
);

CREATE TABLE c3.recall_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recall_id uuid NOT NULL REFERENCES c3.recalls(id),
  pharmacy_id uuid NOT NULL REFERENCES c3.pharmacies(id),
  action_type text NOT NULL CHECK (action_type IN ('ACKNOWLEDGE', 'IDENTIFY_STOCK', 'QUARANTINE', 'REPORT_QUANTITY', 'CLOSE')),
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'COMPLETED')),
  completed_at timestamptz,
  completion_note text,
  completed_by uuid,
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT c3_recall_actions_one_per_type UNIQUE (recall_id, pharmacy_id, action_type),
  CONSTRAINT c3_recall_actions_completed_consistency CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
CREATE INDEX c3_recall_actions_pharmacy ON c3.recall_actions (pharmacy_id, due_at);

CREATE FUNCTION c3.check_recall_action() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  issued timestamptz;
BEGIN
  SELECT r.issued_at INTO issued FROM c3.recalls AS r WHERE r.id = NEW.recall_id;
  IF NEW.due_at < issued THEN
    RAISE EXCEPTION 'c3.recall_actions due_at must not precede the recall issued_at';
  END IF;
  IF NEW.completed_at IS NOT NULL AND NEW.completed_at < issued THEN
    RAISE EXCEPTION 'c3.recall_actions completed_at must not precede the recall issued_at';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION c3.guard_recall() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status = 'CLOSED' THEN
    PERFORM c3.assert_transition('c3.recalls', to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'closed_at']);
  ELSE
    RAISE EXCEPTION 'c3.recalls transition % -> % is not permitted (forward-only)', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION c3.guard_recall_action() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'OPEN' AND NEW.status = 'COMPLETED' THEN
    PERFORM c3.assert_transition('c3.recall_actions', to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['status', 'completed_at', 'completion_note', 'completed_by']);
  ELSE
    RAISE EXCEPTION 'c3.recall_actions transition % -> % is not permitted (forward-only)', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- C: complaints (regulator logs and screens; pharmacy resolves substantiated complaints)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE c3.complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_ref text NOT NULL UNIQUE CHECK (length(btrim(complaint_ref)) > 0),
  pharmacy_id uuid NOT NULL REFERENCES c3.pharmacies(id),
  policy_version text NOT NULL REFERENCES c3.policy(version),
  summary text NOT NULL CHECK (length(btrim(summary)) > 0),
  logged_at timestamptz NOT NULL,
  logged_by uuid,
  status text NOT NULL CHECK (status IN ('LOGGED', 'SUBSTANTIATED', 'UNSUBSTANTIATED', 'RESOLVED')),
  screened_at timestamptz,
  screened_by uuid,
  resolution_due_at timestamptz,
  resolved_at timestamptz,
  resolution_note text,
  resolved_by uuid,
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT c3_complaints_screen_after_log CHECK (screened_at IS NULL OR screened_at >= logged_at),
  CONSTRAINT c3_complaints_resolve_after_screen CHECK (resolved_at IS NULL OR (screened_at IS NOT NULL AND resolved_at >= screened_at)),
  CONSTRAINT c3_complaints_status_consistency CHECK (
    (status = 'LOGGED' AND screened_at IS NULL AND resolution_due_at IS NULL AND resolved_at IS NULL AND resolution_note IS NULL)
    OR (status = 'SUBSTANTIATED' AND screened_at IS NOT NULL AND resolution_due_at IS NOT NULL AND resolved_at IS NULL AND resolution_note IS NULL)
    OR (status = 'UNSUBSTANTIATED' AND screened_at IS NOT NULL AND resolution_due_at IS NULL AND resolved_at IS NULL AND resolution_note IS NULL)
    OR (status = 'RESOLVED' AND screened_at IS NOT NULL AND resolution_due_at IS NOT NULL AND resolved_at IS NOT NULL
        AND length(btrim(COALESCE(resolution_note, ''))) > 0))
);
CREATE INDEX c3_complaints_pharmacy ON c3.complaints (pharmacy_id, resolution_due_at);

CREATE FUNCTION c3.derive_complaint() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target_days integer;
BEGIN
  IF NEW.status IN ('SUBSTANTIATED', 'RESOLVED') AND NEW.screened_at IS NOT NULL THEN
    SELECT p.complaint_resolution_target_days INTO target_days FROM c3.policy AS p WHERE p.version = NEW.policy_version;
    NEW.resolution_due_at := NEW.screened_at + make_interval(days => target_days);
  ELSE
    NEW.resolution_due_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION c3.guard_complaint() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'LOGGED' AND NEW.status IN ('SUBSTANTIATED', 'UNSUBSTANTIATED') THEN
    PERFORM c3.assert_transition('c3.complaints', to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['status', 'screened_at', 'screened_by', 'resolution_due_at']);
  ELSIF OLD.status = 'SUBSTANTIATED' AND NEW.status = 'RESOLVED' THEN
    PERFORM c3.assert_transition('c3.complaints', to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['status', 'resolved_at', 'resolution_note', 'resolved_by']);
  ELSE
    RAISE EXCEPTION 'c3.complaints transition % -> % is not permitted (forward-only)', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- I: inspections, items and critical findings
-- ---------------------------------------------------------------------------------------------

CREATE TABLE c3.inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_ref text NOT NULL UNIQUE CHECK (length(btrim(inspection_ref)) > 0),
  pharmacy_id uuid NOT NULL REFERENCES c3.pharmacies(id),
  policy_version text NOT NULL REFERENCES c3.policy(version),
  inspected_at timestamptz NOT NULL,
  recorded_by uuid,
  status text NOT NULL CHECK (status IN ('DRAFT', 'FINAL')),
  finalised_at timestamptz,
  finalised_by uuid,
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT c3_inspections_final_consistency CHECK ((status = 'FINAL') = (finalised_at IS NOT NULL)),
  CONSTRAINT c3_inspections_final_after_inspection CHECK (finalised_at IS NULL OR finalised_at >= inspected_at)
);
CREATE INDEX c3_inspections_pharmacy ON c3.inspections (pharmacy_id, inspected_at DESC);

CREATE TABLE c3.inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES c3.inspections(id),
  criterion_code text NOT NULL REFERENCES c3.inspection_criteria(code),
  result text NOT NULL CHECK (result IN ('COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE')),
  critical boolean NOT NULL DEFAULT false,
  note text,
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT c3_inspection_items_one_per_criterion UNIQUE (inspection_id, criterion_code),
  CONSTRAINT c3_inspection_items_critical_only_when_non_compliant CHECK (NOT critical OR result = 'NON_COMPLIANT')
);
CREATE INDEX c3_inspection_items_inspection ON c3.inspection_items (inspection_id);

CREATE TABLE c3.critical_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES c3.inspections(id),
  inspection_item_id uuid NOT NULL UNIQUE REFERENCES c3.inspection_items(id),
  pharmacy_id uuid NOT NULL REFERENCES c3.pharmacies(id),
  criterion_code text NOT NULL REFERENCES c3.inspection_criteria(code),
  raised_at timestamptz NOT NULL,
  evidence_class text NOT NULL CHECK (evidence_class IN ('SEEDED_SIMULATED', 'PROTOTYPE_ENTRY')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX c3_critical_findings_pharmacy ON c3.critical_findings (pharmacy_id, raised_at DESC);

CREATE FUNCTION c3.guard_inspection() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'c3.inspections must be created as DRAFT and finalised afterwards';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'FINAL' THEN
    PERFORM c3.assert_transition('c3.inspections', to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['status', 'finalised_at', 'finalised_by']);
    IF NOT EXISTS (SELECT 1 FROM c3.inspection_items AS i WHERE i.inspection_id = NEW.id) THEN
      RAISE EXCEPTION 'c3.inspections cannot be finalised without inspection items';
    END IF;
  ELSE
    RAISE EXCEPTION 'c3.inspections transition % -> % is not permitted (forward-only)', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

-- Finalising an inspection raises one critical finding per critical NON_COMPLIANT item.
CREATE FUNCTION c3.raise_critical_findings() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO c3.critical_findings (inspection_id, inspection_item_id, pharmacy_id, criterion_code, raised_at, evidence_class)
  SELECT NEW.id, i.id, NEW.pharmacy_id, i.criterion_code, NEW.finalised_at, NEW.evidence_class
  FROM c3.inspection_items AS i
  WHERE i.inspection_id = NEW.id AND i.result = 'NON_COMPLIANT' AND i.critical;
  RETURN NULL;
END $$;

CREATE FUNCTION c3.check_inspection_item() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM c3.inspections AS s WHERE s.id = NEW.inspection_id AND s.status = 'DRAFT') THEN
    RAISE EXCEPTION 'c3.inspection_items can only be added to a DRAFT inspection';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION c3.check_critical_finding() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'c3.critical_findings are created only by finalising an inspection';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Assessment snapshots and the append-only audit log
-- ---------------------------------------------------------------------------------------------

CREATE TABLE c3.assessment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES c3.pharmacies(id),
  policy_version text NOT NULL REFERENCES c3.policy(version),
  as_of timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ASSESSABLE', 'NOT_ASSESSABLE')),
  score double precision CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  tier text CHECK (tier IN ('HIGHLY_TRUSTED', 'TRUSTED', 'UNDER_REVIEW', 'ESCALATION_ALERT')),
  breakdown jsonb NOT NULL CHECK (jsonb_typeof(breakdown) = 'object'),
  evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'object'),
  evidence_classes text[] NOT NULL CHECK (evidence_classes <@ ARRAY['SEEDED_SIMULATED', 'PROTOTYPE_ENTRY']::text[]),
  critical_escalation_required boolean NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^0x[0-9a-f]{64}$'),
  computed_by text NOT NULL CHECK (length(btrim(computed_by)) > 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  finalised_at timestamptz,
  finalised_by uuid,
  blockchain_verification text NOT NULL DEFAULT 'NOT_PERFORMED' CHECK (blockchain_verification = 'NOT_PERFORMED'),
  CONSTRAINT c3_snapshots_score_iff_assessable CHECK ((status = 'ASSESSABLE') = (score IS NOT NULL)),
  CONSTRAINT c3_snapshots_tier_iff_assessable CHECK ((status = 'ASSESSABLE') = (tier IS NOT NULL)),
  CONSTRAINT c3_snapshots_finalised_pair CHECK ((finalised_at IS NULL) = (finalised_by IS NULL))
);
CREATE INDEX c3_assessment_snapshots_pharmacy ON c3.assessment_snapshots (pharmacy_id, as_of DESC);

CREATE FUNCTION c3.guard_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.finalised_at IS NOT NULL OR NEW.finalised_at IS NULL THEN
    RAISE EXCEPTION 'c3.assessment_snapshots are immutable; only a single finalisation is permitted';
  END IF;
  PERFORM c3.assert_transition('c3.assessment_snapshots', to_jsonb(OLD), to_jsonb(NEW), ARRAY['finalised_at', 'finalised_by']);
  RETURN NEW;
END $$;

CREATE TABLE c3.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_role text NOT NULL CHECK (actor_role IN ('REGULATOR', 'PHARMACY_USER', 'DISTRIBUTOR', 'SEED', 'PROVISIONING', 'UNSPECIFIED')),
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  target_table text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX c3_audit_log_target ON c3.audit_log (target_table, target_id);
CREATE INDEX c3_audit_log_time ON c3.audit_log (occurred_at);

-- ---------------------------------------------------------------------------------------------
-- Triggers. BEFORE triggers fire in name order: 10 derive/initial, 20 guard/check, 30 evidence.
-- ---------------------------------------------------------------------------------------------

-- Reference data: append-only.
CREATE TRIGGER c3_95_no_update_delete BEFORE UPDATE OR DELETE ON c3.policy FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.policy FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_95_no_update_delete BEFORE UPDATE OR DELETE ON c3.inspection_criteria FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.inspection_criteria FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

-- Pharmacies and distributors: only name/status may change; never deleted.
CREATE TRIGGER c3_20_guard BEFORE UPDATE ON c3.pharmacies FOR EACH ROW EXECUTE FUNCTION c3.guard_columns('display_name', 'status');
CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3.pharmacies FOR EACH ROW EXECUTE FUNCTION c3.enforce_evidence_class();
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE ON c3.pharmacies FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_delete BEFORE DELETE ON c3.pharmacies FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.pharmacies FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_20_guard BEFORE UPDATE ON c3.distributors FOR EACH ROW EXECUTE FUNCTION c3.guard_columns('display_name', 'status');
CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3.distributors FOR EACH ROW EXECUTE FUNCTION c3.enforce_evidence_class();
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE ON c3.distributors FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_delete BEFORE DELETE ON c3.distributors FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.distributors FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

-- User roles: only status may change; deletion (deprovisioning or auth-user cascade) is audited.
CREATE TRIGGER c3_20_guard BEFORE UPDATE ON c3.user_roles FOR EACH ROW EXECUTE FUNCTION c3.guard_columns('status');
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE OR DELETE ON c3.user_roles FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.user_roles FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_10_derive BEFORE INSERT OR UPDATE ON c3.deliveries FOR EACH ROW EXECUTE FUNCTION c3.derive_delivery();
CREATE TRIGGER c3_15_initial BEFORE INSERT ON c3.deliveries FOR EACH ROW EXECUTE FUNCTION c3.require_initial_status('DISPATCHED');
CREATE TRIGGER c3_20_guard BEFORE UPDATE ON c3.deliveries FOR EACH ROW EXECUTE FUNCTION c3.guard_delivery();
CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3.deliveries FOR EACH ROW EXECUTE FUNCTION c3.enforce_evidence_class();
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE ON c3.deliveries FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_delete BEFORE DELETE ON c3.deliveries FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.deliveries FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_15_initial BEFORE INSERT ON c3.recalls FOR EACH ROW EXECUTE FUNCTION c3.require_initial_status('ACTIVE');
CREATE TRIGGER c3_20_guard BEFORE UPDATE ON c3.recalls FOR EACH ROW EXECUTE FUNCTION c3.guard_recall();
CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3.recalls FOR EACH ROW EXECUTE FUNCTION c3.enforce_evidence_class();
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE ON c3.recalls FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_delete BEFORE DELETE ON c3.recalls FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.recalls FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_10_check BEFORE INSERT OR UPDATE ON c3.recall_actions FOR EACH ROW EXECUTE FUNCTION c3.check_recall_action();
CREATE TRIGGER c3_15_initial BEFORE INSERT ON c3.recall_actions FOR EACH ROW EXECUTE FUNCTION c3.require_initial_status('OPEN');
CREATE TRIGGER c3_20_guard BEFORE UPDATE ON c3.recall_actions FOR EACH ROW EXECUTE FUNCTION c3.guard_recall_action();
CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3.recall_actions FOR EACH ROW EXECUTE FUNCTION c3.enforce_evidence_class();
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE ON c3.recall_actions FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_delete BEFORE DELETE ON c3.recall_actions FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.recall_actions FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_10_derive BEFORE INSERT OR UPDATE ON c3.complaints FOR EACH ROW EXECUTE FUNCTION c3.derive_complaint();
CREATE TRIGGER c3_15_initial BEFORE INSERT ON c3.complaints FOR EACH ROW EXECUTE FUNCTION c3.require_initial_status('LOGGED');
CREATE TRIGGER c3_20_guard BEFORE UPDATE ON c3.complaints FOR EACH ROW EXECUTE FUNCTION c3.guard_complaint();
CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3.complaints FOR EACH ROW EXECUTE FUNCTION c3.enforce_evidence_class();
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE ON c3.complaints FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_delete BEFORE DELETE ON c3.complaints FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.complaints FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_20_guard BEFORE INSERT OR UPDATE ON c3.inspections FOR EACH ROW EXECUTE FUNCTION c3.guard_inspection();
CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3.inspections FOR EACH ROW EXECUTE FUNCTION c3.enforce_evidence_class();
CREATE TRIGGER c3_80_critical_findings AFTER UPDATE ON c3.inspections FOR EACH ROW
  WHEN (OLD.status = 'DRAFT' AND NEW.status = 'FINAL') EXECUTE FUNCTION c3.raise_critical_findings();
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE ON c3.inspections FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_delete BEFORE DELETE ON c3.inspections FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.inspections FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_20_check BEFORE INSERT ON c3.inspection_items FOR EACH ROW EXECUTE FUNCTION c3.check_inspection_item();
CREATE TRIGGER c3_30_evidence BEFORE INSERT ON c3.inspection_items FOR EACH ROW EXECUTE FUNCTION c3.enforce_evidence_class();
CREATE TRIGGER c3_90_audit AFTER INSERT ON c3.inspection_items FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_update_delete BEFORE UPDATE OR DELETE ON c3.inspection_items FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.inspection_items FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_20_check BEFORE INSERT ON c3.critical_findings FOR EACH ROW EXECUTE FUNCTION c3.check_critical_finding();
CREATE TRIGGER c3_90_audit AFTER INSERT ON c3.critical_findings FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_update_delete BEFORE UPDATE OR DELETE ON c3.critical_findings FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.critical_findings FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

CREATE TRIGGER c3_20_guard BEFORE UPDATE ON c3.assessment_snapshots FOR EACH ROW EXECUTE FUNCTION c3.guard_snapshot();
CREATE TRIGGER c3_90_audit AFTER INSERT OR UPDATE ON c3.assessment_snapshots FOR EACH ROW EXECUTE FUNCTION c3.write_audit();
CREATE TRIGGER c3_95_no_delete BEFORE DELETE ON c3.assessment_snapshots FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_96_no_truncate BEFORE TRUNCATE ON c3.assessment_snapshots FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

-- Audit log: append-only (no UPDATE, DELETE or TRUNCATE).
CREATE TRIGGER c3_audit_append_only BEFORE UPDATE OR DELETE ON c3.audit_log FOR EACH ROW EXECUTE FUNCTION c3.reject_mutation();
CREATE TRIGGER c3_audit_no_truncate BEFORE TRUNCATE ON c3.audit_log FOR EACH STATEMENT EXECUTE FUNCTION c3.reject_mutation();

-- ---------------------------------------------------------------------------------------------
-- Security: RLS on every table with NO policies (deny by default for anon/authenticated), and
-- privileges revoked on c3 only. Default privileges are deliberately not touched.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE c3.policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.inspection_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.recalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.recall_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.critical_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.assessment_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA c3 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA c3 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA c3 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c3 FROM PUBLIC, anon, authenticated;

COMMIT;
