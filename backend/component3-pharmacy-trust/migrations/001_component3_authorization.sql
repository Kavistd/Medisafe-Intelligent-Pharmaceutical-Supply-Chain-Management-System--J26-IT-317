-- Component 3 authorization schema. NOT EXECUTED.
-- Requires a migration principal allowed to create roles, tables, functions, and triggers.
-- The migration defines fixed, non-login group roles. A DBA must explicitly grant
-- component3_runtime to the exact DATABASE_URL login used by run-postgres.js and
-- component3_provisioner to a separately controlled provisioning login. Never use
-- postgres, a superuser, or a BYPASSRLS role for the API. This file deliberately
-- does not guess environment-specific login role names or grant either group role.

DO $roles$
BEGIN
  -- Never silently repurpose a cluster-wide role name. A pre-existing role
  -- requires manual identity/membership review before this migration can proceed.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('component3_runtime', 'component3_provisioner')) THEN
    RAISE EXCEPTION 'Component 3 role name already exists; inspect role attributes and memberships before proceeding';
  END IF;
  CREATE ROLE component3_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  CREATE ROLE component3_provisioner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
END
$roles$;

CREATE TABLE pharmacy_trust.component3_regulatory_organizations (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  approval_status text NOT NULL CHECK (approval_status IN ('PENDING', 'APPROVED', 'SUSPENDED', 'REVOKED')),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  lifecycle_actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((approved_by_profile_id IS NULL) = (approved_at IS NULL)),
  CHECK (approval_status <> 'APPROVED' OR (approved_by_profile_id IS NOT NULL AND approved_at IS NOT NULL AND approved_by_profile_id <> created_by_profile_id)),
  CHECK ((approval_status = 'REVOKED') = (revoked_at IS NOT NULL))
);

-- A designation is a Component 3 verification record, not an official role catalogue.
-- Provisioning must verify the person's actual designation against an authoritative source.
CREATE TABLE pharmacy_trust.component3_regulatory_designations (
  organization_id uuid NOT NULL REFERENCES pharmacy_trust.component3_regulatory_organizations(organization_id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  functional_designation text NOT NULL CHECK (length(btrim(functional_designation)) > 0),
  proof_reference text NOT NULL CHECK (length(btrim(proof_reference)) > 0),
  verification_status text NOT NULL CHECK (verification_status IN ('PENDING', 'VERIFIED', 'SUSPENDED', 'REVOKED')),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  verified_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  lifecycle_actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, profile_id),
  CHECK ((verified_by_profile_id IS NULL) = (verified_at IS NULL)),
  CHECK (verification_status <> 'VERIFIED' OR (verified_by_profile_id IS NOT NULL AND verified_at IS NOT NULL AND verified_by_profile_id <> created_by_profile_id)),
  CHECK ((verification_status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE TABLE pharmacy_trust.component3_regulatory_organization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES pharmacy_trust.component3_regulatory_organizations(organization_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX component3_regulatory_org_events_time
  ON pharmacy_trust.component3_regulatory_organization_events (organization_id, created_at DESC);

CREATE TABLE pharmacy_trust.component3_regulatory_designation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, profile_id)
    REFERENCES pharmacy_trust.component3_regulatory_designations(organization_id, profile_id) ON DELETE RESTRICT
);
CREATE INDEX component3_regulatory_designation_events_time
  ON pharmacy_trust.component3_regulatory_designation_events (organization_id, profile_id, created_at DESC);

CREATE TABLE pharmacy_trust.component3_pharmacy_wallet_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacy_trust.pharmacies(id) ON DELETE RESTRICT,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  proof_reference text NOT NULL CHECK (length(btrim(proof_reference)) > 0),
  approval_status text NOT NULL CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REVOKED')),
  requested_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  lifecycle_actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > effective_at),
  CHECK ((approved_by_profile_id IS NULL) = (approved_at IS NULL)),
  CHECK (approval_status <> 'APPROVED' OR (approved_by_profile_id IS NOT NULL AND approved_at IS NOT NULL AND approved_by_profile_id <> requested_by_profile_id)),
  CHECK ((approval_status = 'REVOKED') = (revoked_at IS NOT NULL)),
  CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);
CREATE INDEX component3_wallet_assignment_lookup
  ON pharmacy_trust.component3_pharmacy_wallet_assignments (pharmacy_id, approval_status, effective_at, expires_at);
CREATE INDEX component3_wallet_address_lookup
  ON pharmacy_trust.component3_pharmacy_wallet_assignments (lower(wallet_address), approval_status, expires_at);

CREATE TABLE pharmacy_trust.component3_pharmacy_wallet_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES pharmacy_trust.component3_pharmacy_wallet_assignments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX component3_wallet_assignment_events_time
  ON pharmacy_trust.component3_pharmacy_wallet_assignment_events (assignment_id, created_at DESC);

CREATE TABLE pharmacy_trust.component3_regulatory_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES pharmacy_trust.component3_regulatory_organizations(organization_id) ON DELETE RESTRICT,
  grantee_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  pharmacy_id uuid NOT NULL REFERENCES pharmacy_trust.pharmacies(id) ON DELETE RESTRICT,
  permission text NOT NULL CHECK (permission IN ('ASSESSMENT_READ', 'EVIDENCE_READ', 'CRITICAL_FINDINGS_READ')),
  grant_status text NOT NULL CHECK (grant_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  grantor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approver_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  lifecycle_actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  CHECK (expires_at IS NULL OR expires_at > effective_at),
  CHECK ((approver_profile_id IS NULL) = (approved_at IS NULL)),
  CHECK (grant_status <> 'ACTIVE' OR (approver_profile_id IS NOT NULL AND approved_at IS NOT NULL AND approver_profile_id <> grantor_profile_id)),
  CHECK ((grant_status = 'REVOKED') = (revoked_at IS NOT NULL)),
  CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL))
);
CREATE INDEX component3_regulatory_active_grant_lookup
  ON pharmacy_trust.component3_regulatory_access_grants
    (grantee_profile_id, pharmacy_id, permission, grant_status, effective_at, expires_at);
CREATE TABLE pharmacy_trust.component3_regulatory_access_grant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES pharmacy_trust.component3_regulatory_access_grants(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX component3_regulatory_grant_events_time
  ON pharmacy_trust.component3_regulatory_access_grant_events (grant_id, created_at DESC);

-- State changes start in PENDING; only controlled transition paths can approve, suspend,
-- reject, or revoke. The provisioner supplies the human actor identity and the trigger
-- writes a corresponding event in the same transaction.
CREATE FUNCTION pharmacy_trust.component3_guard_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed boolean := false;
  old_state text;
  new_state text;
BEGIN
  old_state := COALESCE(to_jsonb(OLD)->>'approval_status', to_jsonb(OLD)->>'grant_status', to_jsonb(OLD)->>'verification_status');
  new_state := COALESCE(to_jsonb(NEW)->>'approval_status', to_jsonb(NEW)->>'grant_status', to_jsonb(NEW)->>'verification_status');
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME <> 'component3_regulatory_designations' AND new_state IS DISTINCT FROM 'PENDING' THEN
      RAISE EXCEPTION 'Component 3 approval records must start PENDING';
    END IF;
    IF TG_TABLE_NAME = 'component3_regulatory_designations' AND NEW.verification_status <> 'PENDING' THEN
      RAISE EXCEPTION 'Component 3 designations must start PENDING';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'component3_regulatory_designations' THEN
    IF new_state IS NOT DISTINCT FROM old_state THEN
      IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Designation changes require a lifecycle transition'; END IF;
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - ARRAY['verification_status','verified_by_profile_id','verified_at','lifecycle_actor_profile_id','revoked_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['verification_status','verified_by_profile_id','verified_at','lifecycle_actor_profile_id','revoked_at']) THEN
      RAISE EXCEPTION 'Designation identity and evidence are immutable; create a new record';
    END IF;
    allowed := (old_state = 'PENDING' AND new_state IN ('VERIFIED','REVOKED')) OR
      (old_state = 'VERIFIED' AND new_state IN ('SUSPENDED','REVOKED')) OR
      (old_state = 'SUSPENDED' AND new_state IN ('VERIFIED','REVOKED'));
    IF NOT allowed OR NEW.lifecycle_actor_profile_id IS NULL THEN RAISE EXCEPTION 'Invalid designation lifecycle transition'; END IF;
    IF NEW.verification_status = 'VERIFIED' AND (NEW.verified_by_profile_id IS NULL OR NEW.verified_at IS NULL OR
       NEW.verified_by_profile_id = NEW.created_by_profile_id OR
       NEW.lifecycle_actor_profile_id IS DISTINCT FROM NEW.verified_by_profile_id OR
       NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at) THEN
      RAISE EXCEPTION 'Designation verification requires a distinct verifier and fresh timestamp';
    END IF;
    NEW.revoked_at := CASE WHEN new_state = 'REVOKED' THEN COALESCE(NEW.revoked_at, now()) ELSE NULL END;
  ELSE
    IF new_state IS NOT DISTINCT FROM old_state THEN
      IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Approval metadata changes require a lifecycle transition'; END IF;
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - ARRAY['approval_status','grant_status','approved_by_profile_id','approved_at','lifecycle_actor_profile_id','revoked_at','revocation_reason']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['approval_status','grant_status','approved_by_profile_id','approved_at','lifecycle_actor_profile_id','revoked_at','revocation_reason']) THEN
      RAISE EXCEPTION 'Approval identity, scope, and evidence are immutable; create a new record';
    END IF;
    IF TG_TABLE_NAME = 'component3_regulatory_organizations' THEN
      allowed := (old_state = 'PENDING' AND new_state IN ('APPROVED','REVOKED')) OR
        (old_state = 'APPROVED' AND new_state IN ('SUSPENDED','REVOKED')) OR
        (old_state = 'SUSPENDED' AND new_state IN ('APPROVED','REVOKED'));
    ELSIF TG_TABLE_NAME = 'component3_pharmacy_wallet_assignments' THEN
      allowed := (old_state = 'PENDING' AND new_state IN ('APPROVED','REJECTED','REVOKED')) OR
        (old_state = 'APPROVED' AND new_state IN ('SUSPENDED','REVOKED')) OR
        (old_state = 'SUSPENDED' AND new_state IN ('APPROVED','REVOKED'));
    ELSE
      allowed := (old_state = 'PENDING' AND new_state = 'ACTIVE') OR
        (old_state = 'ACTIVE' AND new_state IN ('SUSPENDED','REVOKED')) OR
        (old_state = 'SUSPENDED' AND new_state IN ('ACTIVE','REVOKED'));
    END IF;
    IF NOT allowed OR NEW.lifecycle_actor_profile_id IS NULL THEN RAISE EXCEPTION 'Invalid Component 3 approval lifecycle transition'; END IF;
    IF TG_TABLE_NAME = 'component3_regulatory_organizations' AND NEW.approval_status = 'APPROVED' AND
      (NEW.approved_by_profile_id IS NULL OR NEW.approved_at IS NULL OR NEW.approved_by_profile_id = NEW.created_by_profile_id OR
       NEW.lifecycle_actor_profile_id IS DISTINCT FROM NEW.approved_by_profile_id OR
       NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at) THEN RAISE EXCEPTION 'Approval requires a distinct approver and fresh timestamp'; END IF;
    IF TG_TABLE_NAME = 'component3_pharmacy_wallet_assignments' THEN
      IF (NEW.pharmacy_id, lower(NEW.wallet_address), NEW.proof_reference) IS DISTINCT FROM
         (OLD.pharmacy_id, lower(OLD.wallet_address), OLD.proof_reference) THEN
        RAISE EXCEPTION 'Wallet identity and pharmacy mapping are immutable; create a new assignment';
      END IF;
      IF NEW.approval_status = 'APPROVED' AND (NEW.approved_by_profile_id IS NULL OR NEW.approved_at IS NULL OR
         NEW.approved_by_profile_id = NEW.requested_by_profile_id OR
         NEW.lifecycle_actor_profile_id IS DISTINCT FROM NEW.approved_by_profile_id OR
         NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at) THEN
        RAISE EXCEPTION 'Wallet approval requires a distinct approver and fresh timestamp';
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'component3_regulatory_access_grants' AND NEW.grant_status = 'ACTIVE' AND
      (NEW.approver_profile_id IS NULL OR NEW.approved_at IS NULL OR NEW.approver_profile_id = NEW.grantor_profile_id OR
       NEW.lifecycle_actor_profile_id IS DISTINCT FROM NEW.approver_profile_id OR
       NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at) THEN RAISE EXCEPTION 'Grant activation requires a distinct approver and fresh timestamp'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION pharmacy_trust.component3_guard_wallet_uniqueness() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE lock_id bigint;
BEGIN
  IF NEW.approval_status <> 'APPROVED' OR NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
  -- Lock both identity keys for every approved interval (including future ones).
  -- Sorted acquisition prevents deadlocks; transaction locks serialize concurrent
  -- approvals for the same pharmacy or wallet until the overlap check commits.
  FOR lock_id IN SELECT value FROM unnest(ARRAY[
    hashtextextended(lower(NEW.wallet_address), 0),
    hashtextextended(NEW.pharmacy_id::text, 1)
  ]) AS locks(value) ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(lock_id);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pharmacy_trust.component3_pharmacy_wallet_assignments a
    WHERE a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.approval_status = 'APPROVED' AND a.revoked_at IS NULL
      AND tstzrange(a.effective_at, a.expires_at, '[)') && tstzrange(NEW.effective_at, NEW.expires_at, '[)')
      AND (a.pharmacy_id = NEW.pharmacy_id OR lower(a.wallet_address) = lower(NEW.wallet_address))) THEN
    RAISE EXCEPTION 'Approved wallet assignment intervals overlap for this wallet or pharmacy';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION pharmacy_trust.component3_append_lifecycle_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pharmacy_trust, pg_temp AS $$
DECLARE target_id uuid; event_actor uuid; event_name text; details jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_id := CASE WHEN TG_TABLE_NAME = 'component3_regulatory_designations' THEN NULL ELSE NEW.id END;
    event_actor := CASE TG_TABLE_NAME
      WHEN 'component3_regulatory_organizations' THEN NEW.created_by_profile_id
      WHEN 'component3_regulatory_designations' THEN NEW.created_by_profile_id
      WHEN 'component3_pharmacy_wallet_assignments' THEN NEW.requested_by_profile_id
      ELSE NEW.grantor_profile_id END;
    event_name := 'SUBMITTED';
    details := jsonb_build_object('status', 'PENDING');
  ELSE
    event_actor := NEW.lifecycle_actor_profile_id;
    IF TG_TABLE_NAME = 'component3_regulatory_designations' THEN
      event_name := NEW.verification_status;
      target_id := NULL;
      details := jsonb_build_object('from', OLD.verification_status, 'to', NEW.verification_status);
    ELSIF TG_TABLE_NAME = 'component3_regulatory_organizations' THEN
      event_name := NEW.approval_status; target_id := NEW.organization_id;
      details := jsonb_build_object('from', OLD.approval_status, 'to', NEW.approval_status);
    ELSIF TG_TABLE_NAME = 'component3_pharmacy_wallet_assignments' THEN
      event_name := NEW.approval_status; target_id := NEW.id;
      details := jsonb_build_object('from', OLD.approval_status, 'to', NEW.approval_status);
    ELSE
      event_name := NEW.grant_status; target_id := NEW.id;
      details := jsonb_build_object('from', OLD.grant_status, 'to', NEW.grant_status);
    END IF;
  END IF;
  IF event_actor IS NULL THEN RAISE EXCEPTION 'Lifecycle event requires an actor'; END IF;
  IF TG_TABLE_NAME = 'component3_regulatory_organizations' THEN
    INSERT INTO pharmacy_trust.component3_regulatory_organization_events(organization_id,event_type,actor_profile_id,event_details)
      VALUES (NEW.organization_id,event_name,event_actor,details);
  ELSIF TG_TABLE_NAME = 'component3_regulatory_designations' THEN
    INSERT INTO pharmacy_trust.component3_regulatory_designation_events(organization_id,profile_id,event_type,actor_profile_id,event_details)
      VALUES (NEW.organization_id,NEW.profile_id,event_name,event_actor,details);
  ELSIF TG_TABLE_NAME = 'component3_pharmacy_wallet_assignments' THEN
    INSERT INTO pharmacy_trust.component3_pharmacy_wallet_assignment_events(assignment_id,event_type,actor_profile_id,event_details)
      VALUES (NEW.id,event_name,event_actor,details);
  ELSE
    INSERT INTO pharmacy_trust.component3_regulatory_access_grant_events(grant_id,event_type,actor_profile_id,event_details)
      VALUES (NEW.id,event_name,event_actor,details);
  END IF;
  RETURN NULL;
END $$;

-- Trigger execution does not require PUBLIC callers to invoke this privileged
-- function directly. The migration/trigger owner retains the required privilege.
REVOKE ALL ON FUNCTION pharmacy_trust.component3_append_lifecycle_event() FROM PUBLIC;

CREATE FUNCTION pharmacy_trust.component3_reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Component 3 audit events are append-only'; END $$;

CREATE TRIGGER c3_org_lifecycle BEFORE INSERT OR UPDATE ON pharmacy_trust.component3_regulatory_organizations
  FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_guard_lifecycle();
CREATE TRIGGER c3_designation_lifecycle BEFORE INSERT OR UPDATE ON pharmacy_trust.component3_regulatory_designations
  FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_guard_lifecycle();
CREATE TRIGGER c3_wallet_lifecycle BEFORE INSERT OR UPDATE ON pharmacy_trust.component3_pharmacy_wallet_assignments
  FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_guard_lifecycle();
CREATE TRIGGER c3_wallet_active_unique BEFORE INSERT OR UPDATE OF approval_status, pharmacy_id, wallet_address, effective_at, expires_at, revoked_at
  ON pharmacy_trust.component3_pharmacy_wallet_assignments FOR EACH ROW
  EXECUTE FUNCTION pharmacy_trust.component3_guard_wallet_uniqueness();
CREATE TRIGGER c3_grant_lifecycle BEFORE INSERT OR UPDATE ON pharmacy_trust.component3_regulatory_access_grants
  FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_guard_lifecycle();
CREATE TRIGGER c3_org_events_insert AFTER INSERT ON pharmacy_trust.component3_regulatory_organizations
  FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_append_lifecycle_event();
CREATE TRIGGER c3_org_events_update AFTER UPDATE OF approval_status ON pharmacy_trust.component3_regulatory_organizations
  FOR EACH ROW WHEN (OLD.approval_status IS DISTINCT FROM NEW.approval_status)
  EXECUTE FUNCTION pharmacy_trust.component3_append_lifecycle_event();
CREATE TRIGGER c3_designation_events_insert AFTER INSERT ON pharmacy_trust.component3_regulatory_designations
  FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_append_lifecycle_event();
CREATE TRIGGER c3_designation_events_update AFTER UPDATE OF verification_status ON pharmacy_trust.component3_regulatory_designations
  FOR EACH ROW WHEN (OLD.verification_status IS DISTINCT FROM NEW.verification_status)
  EXECUTE FUNCTION pharmacy_trust.component3_append_lifecycle_event();
CREATE TRIGGER c3_wallet_events_insert AFTER INSERT ON pharmacy_trust.component3_pharmacy_wallet_assignments
  FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_append_lifecycle_event();
CREATE TRIGGER c3_wallet_events_update AFTER UPDATE OF approval_status ON pharmacy_trust.component3_pharmacy_wallet_assignments
  FOR EACH ROW WHEN (OLD.approval_status IS DISTINCT FROM NEW.approval_status)
  EXECUTE FUNCTION pharmacy_trust.component3_append_lifecycle_event();
CREATE TRIGGER c3_grant_events_insert AFTER INSERT ON pharmacy_trust.component3_regulatory_access_grants
  FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_append_lifecycle_event();
CREATE TRIGGER c3_grant_events_update AFTER UPDATE OF grant_status ON pharmacy_trust.component3_regulatory_access_grants
  FOR EACH ROW WHEN (OLD.grant_status IS DISTINCT FROM NEW.grant_status)
  EXECUTE FUNCTION pharmacy_trust.component3_append_lifecycle_event();

-- Wallet mapping approval remains a human-controlled attestation. This trigger and the
-- live Component 4 check do not verify the referenced proof or assert pharmacy ownership.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'component3_regulatory_organizations','component3_regulatory_designations',
    'component3_pharmacy_wallet_assignments','component3_regulatory_access_grants',
    'component3_regulatory_organization_events','component3_regulatory_designation_events',
    'component3_pharmacy_wallet_assignment_events','component3_regulatory_access_grant_events'
  ] LOOP
    EXECUTE format('REVOKE ALL ON pharmacy_trust.%I FROM PUBLIC', table_name);
    EXECUTE format('ALTER TABLE pharmacy_trust.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE pharmacy_trust.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$rls$;

GRANT SELECT ON pharmacy_trust.component3_regulatory_organizations,
  pharmacy_trust.component3_regulatory_designations,
  pharmacy_trust.component3_pharmacy_wallet_assignments,
  pharmacy_trust.component3_regulatory_access_grants TO component3_runtime;
GRANT SELECT, INSERT, UPDATE ON pharmacy_trust.component3_regulatory_organizations,
  pharmacy_trust.component3_regulatory_designations,
  pharmacy_trust.component3_pharmacy_wallet_assignments,
  pharmacy_trust.component3_regulatory_access_grants TO component3_provisioner;
GRANT SELECT ON pharmacy_trust.component3_regulatory_organization_events,
  pharmacy_trust.component3_regulatory_designation_events,
  pharmacy_trust.component3_pharmacy_wallet_assignment_events,
  pharmacy_trust.component3_regulatory_access_grant_events TO component3_provisioner;
GRANT USAGE ON SCHEMA public, pharmacy_trust TO component3_runtime, component3_provisioner;
-- The API's fixed SELECT statements need only these source columns. Existing RLS on
-- shared tables must independently permit the dedicated runtime role; this migration
-- intentionally does not weaken or replace Component 1/shared-table policies.
GRANT SELECT (id, status) ON public.organizations TO component3_runtime;
GRANT SELECT (organization_id, profile_id, member_role, status) ON public.organization_members TO component3_runtime;
GRANT SELECT (id) ON public.profiles TO component3_runtime;
GRANT SELECT (id, pharmacy_code, organization_id) ON pharmacy_trust.pharmacies TO component3_runtime;
GRANT SELECT (id, pharmacy_id, assessed_at, created_at, critical_escalation_required, evidence_source)
  ON pharmacy_trust.trust_assessments TO component3_runtime;
GRANT SELECT (assessment_id, indicator_type) ON pharmacy_trust.indicator_scores TO component3_runtime;
GRANT SELECT (id, pharmacy_id, indicator_type, event_type, source_type, source_system, source_reference, event_timestamp)
  ON pharmacy_trust.evidence TO component3_runtime;
GRANT SELECT (assessment_id, evidence_id) ON pharmacy_trust.assessment_evidence TO component3_runtime;

CREATE POLICY c3_runtime_read_orgs ON pharmacy_trust.component3_regulatory_organizations FOR SELECT TO component3_runtime USING (true);
CREATE POLICY c3_provisioner_orgs ON pharmacy_trust.component3_regulatory_organizations FOR ALL TO component3_provisioner USING (true) WITH CHECK (true);
CREATE POLICY c3_runtime_read_designations ON pharmacy_trust.component3_regulatory_designations FOR SELECT TO component3_runtime USING (true);
CREATE POLICY c3_provisioner_designations ON pharmacy_trust.component3_regulatory_designations FOR ALL TO component3_provisioner USING (true) WITH CHECK (true);
CREATE POLICY c3_runtime_read_wallets ON pharmacy_trust.component3_pharmacy_wallet_assignments FOR SELECT TO component3_runtime USING (true);
CREATE POLICY c3_provisioner_wallets ON pharmacy_trust.component3_pharmacy_wallet_assignments FOR ALL TO component3_provisioner USING (true) WITH CHECK (true);
CREATE POLICY c3_runtime_read_grants ON pharmacy_trust.component3_regulatory_access_grants FOR SELECT TO component3_runtime USING (true);
CREATE POLICY c3_provisioner_grants ON pharmacy_trust.component3_regulatory_access_grants FOR ALL TO component3_provisioner USING (true) WITH CHECK (true);
CREATE POLICY c3_provisioner_read_org_events ON pharmacy_trust.component3_regulatory_organization_events FOR SELECT TO component3_provisioner USING (true);
CREATE POLICY c3_provisioner_read_designation_events ON pharmacy_trust.component3_regulatory_designation_events FOR SELECT TO component3_provisioner USING (true);
CREATE POLICY c3_provisioner_read_wallet_events ON pharmacy_trust.component3_pharmacy_wallet_assignment_events FOR SELECT TO component3_provisioner USING (true);
CREATE POLICY c3_provisioner_read_grant_events ON pharmacy_trust.component3_regulatory_access_grant_events FOR SELECT TO component3_provisioner USING (true);
-- Trigger-originated inserts only. Ordinary direct INSERT, UPDATE, DELETE, and TRUNCATE
-- are denied even if a role happens to have legacy table privileges.
CREATE POLICY c3_trigger_org_event_insert ON pharmacy_trust.component3_regulatory_organization_events FOR INSERT TO PUBLIC WITH CHECK (pg_trigger_depth() > 0);
CREATE POLICY c3_trigger_designation_event_insert ON pharmacy_trust.component3_regulatory_designation_events FOR INSERT TO PUBLIC WITH CHECK (pg_trigger_depth() > 0);
CREATE POLICY c3_trigger_wallet_event_insert ON pharmacy_trust.component3_pharmacy_wallet_assignment_events FOR INSERT TO PUBLIC WITH CHECK (pg_trigger_depth() > 0);
CREATE POLICY c3_trigger_grant_event_insert ON pharmacy_trust.component3_regulatory_access_grant_events FOR INSERT TO PUBLIC WITH CHECK (pg_trigger_depth() > 0);

DO $audit_triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'component3_regulatory_organization_events','component3_regulatory_designation_events',
    'component3_pharmacy_wallet_assignment_events','component3_regulatory_access_grant_events'
  ] LOOP
    EXECUTE format('CREATE TRIGGER c3_no_audit_row_mutation BEFORE UPDATE OR DELETE ON pharmacy_trust.%I FOR EACH ROW EXECUTE FUNCTION pharmacy_trust.component3_reject_audit_mutation()', table_name);
    EXECUTE format('CREATE TRIGGER c3_no_audit_truncate BEFORE TRUNCATE ON pharmacy_trust.%I FOR EACH STATEMENT EXECUTE FUNCTION pharmacy_trust.component3_reject_audit_mutation()', table_name);
  END LOOP;
END
$audit_triggers$;

-- The owner/superuser and any BYPASSRLS role remain outside these protections. Keep
-- those credentials out of the API and use external, separately audited DBA controls.
