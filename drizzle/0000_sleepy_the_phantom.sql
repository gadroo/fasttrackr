CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"account_identifier" text,
	"account_type_raw" text NOT NULL,
	"account_type_norm" text NOT NULL,
	"co_owner_name" text,
	"custodian" text,
	"account_value" double precision,
	"ownership_pct" double precision,
	"ownership_type" text,
	"decision_making" text,
	"source_of_funds" text,
	"primary_use" text,
	"liquidity_needs" text,
	"liquidity_horizon" text,
	"is_uncertain" boolean DEFAULT false NOT NULL,
	"investment_experience" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"bank_name" text,
	"bank_type" text,
	"account_number" text,
	"routing_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"percentage" double precision,
	"dob" timestamp,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_proposal_artifacts" (
	"change_proposal_id" uuid NOT NULL,
	"source_artifact_id" uuid NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "change_proposal_artifacts_change_proposal_id_source_artifact_id_pk" PRIMARY KEY("change_proposal_id","source_artifact_id")
);
--> statement-breakpoint
CREATE TABLE "change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_job_id" uuid NOT NULL,
	"target_table" text NOT NULL,
	"target_id" uuid,
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"category" text,
	"member_name" text,
	"verbatim_quote" text,
	"ambiguity_note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_table" text NOT NULL,
	"target_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"source_type" text NOT NULL,
	"source_artifact_id" uuid,
	"import_job_id" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"income" double precision,
	"liquid_net_worth" double precision,
	"total_net_worth" double precision,
	"tax_bracket_raw" text,
	"tax_bracket_pct" double precision,
	"expense_range" text,
	"risk_tolerance" text,
	"time_horizon" text,
	"investment_objective" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"filename" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_household_id" uuid,
	"row_count" integer,
	"sheets_found" integer,
	"sheets_parsed" integer,
	"sheets_skipped" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"relationship" text DEFAULT 'other',
	"dob" timestamp,
	"dob_raw" text,
	"ssn_last4" text,
	"phone" text,
	"email" text,
	"address" text,
	"occupation" text,
	"employer" text,
	"marital_status" text,
	"is_business_entity" boolean DEFAULT false NOT NULL,
	"drivers_license_number" text,
	"drivers_license_state" text,
	"drivers_license_issued" timestamp,
	"drivers_license_expires" timestamp,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_job_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"raw_content" jsonb NOT NULL,
	"sheet_name" text,
	"row_number" integer,
	"segment_index" integer,
	"timestamp_start" double precision,
	"timestamp_end" double precision
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposal_artifacts" ADD CONSTRAINT "change_proposal_artifacts_change_proposal_id_change_proposals_id_fk" FOREIGN KEY ("change_proposal_id") REFERENCES "public"."change_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposal_artifacts" ADD CONSTRAINT "change_proposal_artifacts_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_provenance" ADD CONSTRAINT "field_provenance_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_target_household_id_households_id_fk" FOREIGN KEY ("target_household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_member_idx" ON "accounts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "accounts_household_idx" ON "accounts" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "bank_member_idx" ON "bank_details" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "beneficiary_account_idx" ON "beneficiaries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "change_proposal_artifacts_idx" ON "change_proposal_artifacts" USING btree ("change_proposal_id");--> statement-breakpoint
CREATE INDEX "change_proposals_import_idx" ON "change_proposals" USING btree ("import_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_provenance_unique" ON "field_provenance" USING btree ("target_table","target_id","field_name");--> statement-breakpoint
CREATE INDEX "field_provenance_target_idx" ON "field_provenance" USING btree ("target_table","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "households_name_address_uq" ON "households" USING btree ("name","address");--> statement-breakpoint
CREATE INDEX "import_jobs_type_idx" ON "import_jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "members_household_idx" ON "members" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "artifacts_import_idx" ON "source_artifacts" USING btree ("import_job_id");