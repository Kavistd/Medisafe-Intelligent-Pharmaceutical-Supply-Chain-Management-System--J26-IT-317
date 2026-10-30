-- OBSERVED SCHEMA SNAPSHOT — REFERENCE ONLY; NOT A MIGRATION.
-- Captured from PostgreSQL catalog metadata on 2026-10-21.
-- Do not execute this file against the existing Supabase database. It documents
-- the observed pharmacy_trust relations; it does not authorize creating or
-- altering any live table. Re-query the catalog before using as a migration base.
-- External referenced relations are documented by their observed FK targets;
-- their definitions are outside this snapshot.

CREATE TABLE pharmacy_trust.pharmacies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  participant_id uuid,
  pharmacy_code text NOT NULL,
  pharmacy_name text NOT NULL,
  registration_number text,
  registration_status text NOT NULL DEFAULT 'UNVERIFIED'::text,
  wallet_address text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pharmacies_pkey PRIMARY KEY (id),
  CONSTRAINT pharmacies_pharmacy_code_key UNIQUE (pharmacy_code),
  CONSTRAINT pharmacies_wallet_address_key UNIQUE (wallet_address),
  CONSTRAINT pharmacies_registration_status_check CHECK (registration_status = ANY (ARRAY['UNVERIFIED'::text, 'PENDING_VERIFICATION'::text, 'VERIFIED'::text, 'SUSPENDED'::text, 'REVOKED'::text])),
  CONSTRAINT pharmacies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL,
  CONSTRAINT pharmacies_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES traceability.participants(id) ON DELETE SET NULL
);

CREATE TABLE pharmacy_trust.trust_assessments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  assessment_status text NOT NULL DEFAULT 'NOT_ASSESSABLE'::text,
  overall_score numeric(5,2),
  trust_tier text,
  scoring_policy_version text NOT NULL,
  evidence_source text NOT NULL DEFAULT 'SYNTHETIC'::text,
  critical_escalation_required boolean NOT NULL DEFAULT false,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT trust_assessments_pkey PRIMARY KEY (id),
  CONSTRAINT trust_assessments_pharmacy_id_fkey FOREIGN KEY (pharmacy_id) REFERENCES pharmacy_trust.pharmacies(id) ON DELETE CASCADE,
  CONSTRAINT trust_assessments_assessment_status_check CHECK (assessment_status = ANY (ARRAY['ASSESSABLE'::text, 'NOT_ASSESSABLE'::text, 'FAILED'::text])),
  CONSTRAINT trust_assessments_check CHECK (((assessment_status = 'ASSESSABLE'::text) AND (overall_score IS NOT NULL)) OR ((assessment_status <> 'ASSESSABLE'::text) AND (overall_score IS NULL))),
  CONSTRAINT trust_assessments_evidence_source_check CHECK (evidence_source = ANY (ARRAY['SYNTHETIC'::text, 'REAL'::text, 'MIXED'::text, 'UNVERIFIED'::text])),
  CONSTRAINT trust_assessments_overall_score_check CHECK ((overall_score IS NULL) OR ((overall_score >= 0::numeric) AND (overall_score <= 100::numeric))),
  CONSTRAINT trust_assessments_trust_tier_check CHECK ((trust_tier IS NULL) OR (trust_tier = ANY (ARRAY['HIGHLY_TRUSTED'::text, 'TRUSTED'::text, 'UNDER_REVIEW'::text, 'ESCALATION_ALERT'::text, 'NOT_ASSESSABLE'::text])))
);

CREATE TABLE pharmacy_trust.indicator_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL,
  indicator_type text NOT NULL,
  indicator_status text NOT NULL,
  indicator_score numeric(5,2),
  weight numeric(5,4) NOT NULL,
  weighted_contribution numeric(7,3),
  evidence_count integer NOT NULL DEFAULT 0,
  evidence_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT indicator_scores_pkey PRIMARY KEY (id),
  CONSTRAINT indicator_scores_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES pharmacy_trust.trust_assessments(id) ON DELETE CASCADE,
  CONSTRAINT indicator_scores_assessment_id_indicator_type_key UNIQUE (assessment_id, indicator_type),
  CONSTRAINT indicator_scores_check CHECK (((indicator_status = 'ASSESSABLE'::text) AND (indicator_score IS NOT NULL) AND (weighted_contribution IS NOT NULL)) OR ((indicator_status = 'NOT_ASSESSABLE'::text) AND (indicator_score IS NULL) AND (weighted_contribution IS NULL))),
  CONSTRAINT indicator_scores_evidence_count_check CHECK (evidence_count >= 0),
  CONSTRAINT indicator_scores_indicator_score_check CHECK ((indicator_score IS NULL) OR ((indicator_score >= 0::numeric) AND (indicator_score <= 100::numeric))),
  CONSTRAINT indicator_scores_indicator_status_check CHECK (indicator_status = ANY (ARRAY['ASSESSABLE'::text, 'NOT_ASSESSABLE'::text])),
  CONSTRAINT indicator_scores_indicator_type_check CHECK (indicator_type = ANY (ARRAY['DELIVERY'::text, 'RECALL'::text, 'COMPLAINT'::text, 'INSPECTION'::text])),
  CONSTRAINT indicator_scores_weight_check CHECK ((weight >= 0::numeric) AND (weight <= 1::numeric))
);

CREATE TABLE pharmacy_trust.evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  indicator_type text NOT NULL,
  event_type text NOT NULL,
  source_type text NOT NULL,
  source_system text,
  source_reference text,
  verification_status text NOT NULL DEFAULT 'UNVERIFIED'::text,
  event_timestamp timestamp with time zone,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum_sha256 text,
  recorded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT evidence_pkey PRIMARY KEY (id),
  CONSTRAINT evidence_pharmacy_id_source_system_source_reference_key UNIQUE (pharmacy_id, source_system, source_reference),
  CONSTRAINT evidence_pharmacy_id_fkey FOREIGN KEY (pharmacy_id) REFERENCES pharmacy_trust.pharmacies(id) ON DELETE CASCADE,
  CONSTRAINT evidence_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT evidence_indicator_type_check CHECK (indicator_type = ANY (ARRAY['DELIVERY'::text, 'RECALL'::text, 'COMPLAINT'::text, 'INSPECTION'::text])),
  CONSTRAINT evidence_source_type_check CHECK (source_type = ANY (ARRAY['SYNTHETIC'::text, 'DECLARED_REAL'::text, 'VERIFIED_REAL'::text, 'ON_CHAIN_VERIFIED'::text, 'UNVERIFIED'::text])),
  CONSTRAINT evidence_verification_status_check CHECK (verification_status = ANY (ARRAY['UNVERIFIED'::text, 'PENDING'::text, 'VERIFIED'::text, 'REJECTED'::text, 'CONFLICTING'::text, 'DUPLICATE'::text]))
);

CREATE TABLE pharmacy_trust.assessment_evidence (
  assessment_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT assessment_evidence_pkey PRIMARY KEY (assessment_id, evidence_id),
  CONSTRAINT assessment_evidence_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES pharmacy_trust.trust_assessments(id) ON DELETE CASCADE,
  CONSTRAINT assessment_evidence_evidence_id_fkey FOREIGN KEY (evidence_id) REFERENCES pharmacy_trust.evidence(id) ON DELETE RESTRICT
);

-- Observed indexes. Primary-key/unique indexes are generated by the constraints
-- above; they are listed here as comments to preserve the exact catalog inventory
-- without defining each index twice.
-- CREATE UNIQUE INDEX assessment_evidence_pkey ON pharmacy_trust.assessment_evidence USING btree (assessment_id, evidence_id);
-- CREATE INDEX idx_assessment_evidence_evidence ON pharmacy_trust.assessment_evidence USING btree (evidence_id);
-- CREATE UNIQUE INDEX evidence_pharmacy_id_source_system_source_reference_key ON pharmacy_trust.evidence USING btree (pharmacy_id, source_system, source_reference);
-- CREATE UNIQUE INDEX evidence_pkey ON pharmacy_trust.evidence USING btree (id);
-- CREATE INDEX idx_evidence_pharmacy_indicator_time ON pharmacy_trust.evidence USING btree (pharmacy_id, indicator_type, event_timestamp DESC);
-- CREATE INDEX idx_evidence_verification ON pharmacy_trust.evidence USING btree (verification_status);
-- CREATE INDEX idx_indicator_scores_assessment ON pharmacy_trust.indicator_scores USING btree (assessment_id);
-- CREATE UNIQUE INDEX indicator_scores_assessment_id_indicator_type_key ON pharmacy_trust.indicator_scores USING btree (assessment_id, indicator_type);
-- CREATE UNIQUE INDEX indicator_scores_pkey ON pharmacy_trust.indicator_scores USING btree (id);
-- CREATE INDEX idx_pharmacies_org ON pharmacy_trust.pharmacies USING btree (organization_id);
-- CREATE UNIQUE INDEX pharmacies_pharmacy_code_key ON pharmacy_trust.pharmacies USING btree (pharmacy_code);
-- CREATE UNIQUE INDEX pharmacies_pkey ON pharmacy_trust.pharmacies USING btree (id);
-- CREATE UNIQUE INDEX pharmacies_wallet_address_key ON pharmacy_trust.pharmacies USING btree (wallet_address);
-- CREATE INDEX idx_trust_assessments_pharmacy_time ON pharmacy_trust.trust_assessments USING btree (pharmacy_id, assessed_at DESC);
-- CREATE UNIQUE INDEX trust_assessments_pkey ON pharmacy_trust.trust_assessments USING btree (id);
