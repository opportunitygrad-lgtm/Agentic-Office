-- Stage 03: immutable helper so tags can feed the generated search vector
-- (array_to_string is only STABLE, which generated columns do not allow).
CREATE OR REPLACE FUNCTION aibos_tags_text(tags text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT coalesce(array_to_string(tags, ' '), '') $$;--> statement-breakpoint
CREATE TYPE "public"."ai_policy_mode" AS ENUM('disabled', 'approval_required', 'allowed');--> statement-breakpoint
CREATE TYPE "public"."brand_rule_category" AS ENUM('voice', 'tone', 'positioning', 'visual', 'claims', 'prohibited_terms', 'approved_terms', 'call_to_action', 'social_media', 'email', 'website', 'advertising', 'custom');--> statement-breakpoint
CREATE TYPE "public"."commercial_rule_category" AS ENUM('pricing', 'discount', 'payment', 'refund', 'revenue_target', 'financial_approval', 'advertising_budget', 'sales_restriction', 'custom');--> statement-breakpoint
CREATE TYPE "public"."commercial_rule_effect" AS ENUM('info', 'limit', 'require_approval', 'prohibit');--> statement-breakpoint
CREATE TYPE "public"."compliance_effect" AS ENUM('info', 'require_approval', 'prohibit', 'require_disclosure');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."knowledge_link_target" AS ENUM('task', 'agent');--> statement-breakpoint
CREATE TYPE "public"."knowledge_scope" AS ENUM('company', 'global');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_type" AS ENUM('management_entry', 'company_document', 'company_website', 'partner_document', 'email', 'google_sheet', 'web_research', 'grok_research', 'claude_research', 'openai_research', 'system_generated', 'import', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."knowledge_status" AS ENUM('draft', 'review', 'approved', 'superseded', 'archived');--> statement-breakpoint
CREATE TYPE "public"."knowledge_type" AS ENUM('company_fact', 'service', 'product', 'pricing', 'policy', 'brand_rule', 'faq', 'sop', 'compliance', 'legal', 'financial', 'sales', 'marketing', 'technical', 'website', 'partnership', 'contact', 'provider', 'competitor', 'market_research', 'customer_guidance', 'email_template', 'communication_rule', 'document', 'custom');--> statement-breakpoint
CREATE TYPE "public"."rule_channel" AS ENUM('all', 'email', 'social_media', 'website', 'advertising', 'sales', 'support', 'internal');--> statement-breakpoint
CREATE TYPE "public"."rule_period" AS ENUM('per_action', 'day', 'week', 'month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."rule_severity" AS ENUM('info', 'required', 'critical');--> statement-breakpoint
CREATE TYPE "public"."rule_status" AS ENUM('draft', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sensitivity_level" AS ENUM('public', 'internal', 'confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."stale_knowledge_policy" AS ENUM('exclude', 'mark_stale');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'partially_verified', 'verified', 'management_confirmed');--> statement-breakpoint
CREATE TABLE "agent_knowledge_profiles" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"required_types" "knowledge_type"[] DEFAULT '{}' NOT NULL,
	"preferred_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"brand_categories" "brand_rule_category"[] DEFAULT '{}' NOT NULL,
	"commercial_categories" "commercial_rule_category"[] DEFAULT '{}' NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" "rule_severity" DEFAULT 'required' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"status" "rule_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" "brand_rule_category" NOT NULL,
	"channel" "rule_channel" DEFAULT 'all' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" "rule_severity" DEFAULT 'required' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"status" "rule_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" "commercial_rule_category" NOT NULL,
	"applies_to" text NOT NULL,
	"effect" "commercial_rule_effect" DEFAULT 'info' NOT NULL,
	"limit_amount" numeric(18, 2),
	"currency" text,
	"period" "rule_period",
	"required_permission" text,
	CONSTRAINT "commercial_limit_nonneg" CHECK ("commercial_rules"."limit_amount" is null or "commercial_rules"."limit_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "company_ai_policies" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"allowed_providers" "provider_type"[] DEFAULT '{CLAUDE,OPENAI,GROK,LOCAL}'::provider_type[] NOT NULL,
	"default_research_limit" integer DEFAULT 20 NOT NULL,
	"deep_research_policy" "ai_policy_mode" DEFAULT 'approval_required' NOT NULL,
	"external_action_policy" "ai_policy_mode" DEFAULT 'approval_required' NOT NULL,
	"browser_policy" "ai_policy_mode" DEFAULT 'approval_required' NOT NULL,
	"auto_send_policy" "ai_policy_mode" DEFAULT 'disabled' NOT NULL,
	"stale_knowledge_policy" "stale_knowledge_policy" DEFAULT 'exclude' NOT NULL,
	"custom_rules" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" "rule_severity" DEFAULT 'required' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"status" "rule_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"jurisdiction" text,
	"effect" "compliance_effect" DEFAULT 'info' NOT NULL,
	"disclosure_text" text,
	"required_permission" text
);
--> statement-breakpoint
CREATE TABLE "knowledge_access_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"department_id" uuid,
	"max_sensitivity" "sensitivity_level" NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_access_uq" UNIQUE NULLS NOT DISTINCT("company_id","agent_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"scope" "knowledge_scope" DEFAULT 'company' NOT NULL,
	"department_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"type" "knowledge_type" NOT NULL,
	"category" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_type" "knowledge_source_type" DEFAULT 'unknown' NOT NULL,
	"source_reference" text,
	"source_url" text,
	"source_file_ref" text,
	"source_owner" text,
	"provenance_notes" text,
	"confidence" "confidence_level" DEFAULT 'medium' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"status" "knowledge_status" DEFAULT 'draft' NOT NULL,
	"sensitivity" "sensitivity_level" DEFAULT 'internal' NOT NULL,
	"usable_as_unverified" boolean DEFAULT false NOT NULL,
	"effective_at" timestamp with time zone,
	"review_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"conflict_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"lineage_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"superseded_by_id" uuid,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', aibos_tags_text(tags)), 'A') || setweight(to_tsvector('english', coalesce(summary, '')), 'B') || setweight(to_tsvector('english', coalesce(content, '')), 'C')) STORED,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_scope_company" CHECK (("knowledge_items"."scope" = 'global') = ("knowledge_items"."company_id" is null)),
	CONSTRAINT "knowledge_ai_not_management_confirmed" CHECK (not ("knowledge_items"."source_type" in ('grok_research','claude_research','openai_research','system_generated') and "knowledge_items"."verification_status" = 'management_confirmed'))
);
--> statement-breakpoint
CREATE TABLE "knowledge_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_id" uuid NOT NULL,
	"target" "knowledge_link_target" NOT NULL,
	"task_id" uuid,
	"agent_id" uuid,
	"note" text,
	"created_by_user_id" uuid,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_links_uq" UNIQUE NULLS NOT DISTINCT("knowledge_id","task_id","agent_id"),
	CONSTRAINT "knowledge_links_target" CHECK (("knowledge_links"."target" = 'task' and "knowledge_links"."task_id" is not null and "knowledge_links"."agent_id" is null) or ("knowledge_links"."target" = 'agent' and "knowledge_links"."agent_id" is not null and "knowledge_links"."task_id" is null))
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "trading_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "contact_address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tax_identifier" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "products" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "revenue_model" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "secondary_objectives" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sales_channels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "marketing_channels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "brand_personality" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "brand_voice" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "visual_guidance" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "approved_phrases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "prohibited_phrases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "claims_allowed" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "claims_requiring_evidence" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "jurisdictions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "regulators" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "legal_disclaimers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "data_handling_rules" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "allow_unverified_context" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_knowledge_profiles" ADD CONSTRAINT "agent_knowledge_profiles_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_profiles" ADD CONSTRAINT "agent_knowledge_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_rules" ADD CONSTRAINT "commercial_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_rules" ADD CONSTRAINT "commercial_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_rules" ADD CONSTRAINT "commercial_rules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_rules" ADD CONSTRAINT "commercial_rules_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD CONSTRAINT "company_ai_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD CONSTRAINT "company_ai_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_policies" ADD CONSTRAINT "knowledge_access_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_policies" ADD CONSTRAINT "knowledge_access_policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_policies" ADD CONSTRAINT "knowledge_access_policies_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_access_policies" ADD CONSTRAINT "knowledge_access_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_supersedes_id_knowledge_items_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."knowledge_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_superseded_by_id_knowledge_items_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."knowledge_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_knowledge_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_links" ADD CONSTRAINT "knowledge_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_rules_company_idx" ON "brand_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "commercial_rules_company_idx" ON "commercial_rules" USING btree ("company_id","applies_to");--> statement-breakpoint
CREATE INDEX "compliance_rules_company_idx" ON "compliance_rules" USING btree ("company_id","action");--> statement-breakpoint
CREATE INDEX "knowledge_company_status_idx" ON "knowledge_items" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_lineage_idx" ON "knowledge_items" USING btree ("lineage_id");--> statement-breakpoint
CREATE INDEX "knowledge_search_idx" ON "knowledge_items" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_lineage_approved_uq" ON "knowledge_items" USING btree ("lineage_id") WHERE status = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_lineage_open_uq" ON "knowledge_items" USING btree ("lineage_id") WHERE status in ('draft', 'review');--> statement-breakpoint
CREATE INDEX "knowledge_links_task_idx" ON "knowledge_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "knowledge_links_agent_idx" ON "knowledge_links" USING btree ("agent_id");--> statement-breakpoint
-- Every existing company gets a default AI operations policy.
INSERT INTO "company_ai_policies" ("company_id") SELECT "id" FROM "companies" ON CONFLICT DO NOTHING;
