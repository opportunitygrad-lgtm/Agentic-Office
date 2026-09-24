CREATE TYPE "public"."actor_kind" AS ENUM('human', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_scope" AS ENUM('global', 'company');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('sleeping', 'queued', 'working', 'waiting', 'blocked', 'needs_approval', 'paused', 'failed', 'completed', 'offline');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('email_send', 'ad_launch', 'ad_budget_increase', 'financial_action', 'deep_research', 'browser_action', 'website_deployment', 'code_deployment', 'legal_commercial_action', 'destructive_action', 'custom');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."auth_state" AS ENUM('none', 'pending', 'authorized', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."autonomy_level" AS ENUM('observe', 'suggest', 'act_with_approval', 'autonomous_limited', 'autonomous');--> statement-breakpoint
CREATE TYPE "public"."budget_action" AS ENUM('warn', 'require_approval', 'block');--> statement-breakpoint
CREATE TYPE "public"."budget_scope" AS ENUM('task', 'agent_day', 'company_day', 'company_month', 'provider_day', 'global_day');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."data_origin" AS ENUM('live', 'dev_seed');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('microsoft_outlook', 'google_sheets', 'google_drive', 'meta', 'facebook', 'instagram', 'google_analytics', 'google_search_console', 'wordpress', 'website_monitoring', 'playwright_browser', 'grok_x_search', 'claude', 'openai', 'crm', 'webhooks');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('not_configured', 'pending_auth', 'connected', 'degraded', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('CLAUDE', 'OPENAI', 'GROK', 'LOCAL');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'assigned', 'running', 'waiting', 'needs_approval', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('management', 'research', 'verification', 'email', 'marketing', 'advertising', 'analysis', 'technical', 'website', 'sales', 'review', 'custom');--> statement-breakpoint
CREATE TABLE "agent_company_assignments" (
	"agent_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"role" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_company_assignments_agent_id_company_id_pk" PRIMARY KEY("agent_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "agent_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"department_slug" text NOT NULL,
	"default_provider" "provider_type" NOT NULL,
	"fallback_provider" "provider_type",
	"default_autonomy" "autonomy_level" NOT NULL,
	"responsibilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"prohibited_actions" text[] DEFAULT '{}'::text[] NOT NULL,
	"approval_requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"prompt_version" text,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"template_key" text NOT NULL,
	"scope" "agent_scope" DEFAULT 'company' NOT NULL,
	"status" "agent_status" DEFAULT 'sleeping' NOT NULL,
	"department_id" uuid,
	"reports_to_agent_id" uuid,
	"primary_provider" "provider_type" DEFAULT 'CLAUDE' NOT NULL,
	"fallback_provider" "provider_type",
	"preferred_model" text,
	"autonomy_level" "autonomy_level" DEFAULT 'suggest' NOT NULL,
	"system_instructions" text,
	"responsibilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"prohibited_actions" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_tools" text[] DEFAULT '{}'::text[] NOT NULL,
	"read_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"write_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"approval_requirements" text[] DEFAULT '{}'::text[] NOT NULL,
	"per_task_budget" numeric(14, 6) DEFAULT 2 NOT NULL,
	"daily_budget" numeric(14, 6) DEFAULT 10 NOT NULL,
	"max_external_searches" integer DEFAULT 20 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"concurrency_limit" integer DEFAULT 1 NOT NULL,
	"is_temporary" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_concurrency_range" CHECK ("agents"."concurrency_limit" BETWEEN 1 AND 50),
	CONSTRAINT "agents_budget_nonneg" CHECK ("agents"."per_task_budget" >= 0 AND "agents"."daily_budget" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" "provider_type" NOT NULL,
	"model" text NOT NULL,
	"company_id" uuid,
	"agent_id" uuid,
	"task_id" uuid,
	"request_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"tool_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
	"provider_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
	"actual_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
	"origin" "data_origin" DEFAULT 'live' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"task_id" uuid,
	"agent_id" uuid,
	"type" "approval_type" NOT NULL,
	"requested_action" text NOT NULL,
	"explanation" text,
	"risk_level" "risk_level" DEFAULT 'medium' NOT NULL,
	"proposed_change" jsonb,
	"before_state" jsonb,
	"after_state" jsonb,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"decided_by" text,
	"decision_notes" text,
	"decided_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" uuid,
	"agent_id" uuid,
	"task_id" uuid,
	"actor_user" text,
	"action" text NOT NULL,
	"tool" text,
	"provider" "provider_type",
	"description" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"outcome" "audit_outcome" DEFAULT 'success' NOT NULL,
	"error" text,
	"ip_address" "inet",
	"session_id" text,
	"user_agent" text,
	"request_id" text,
	"origin" "data_origin" DEFAULT 'live' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" "budget_scope" NOT NULL,
	"company_id" uuid,
	"agent_id" uuid,
	"task_id" uuid,
	"provider" "provider_type",
	"limit_usd" numeric(14, 6) NOT NULL,
	"warn_at_percent" integer DEFAULT 80 NOT NULL,
	"action_on_exceed" "budget_action" DEFAULT 'require_approval' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_limit_nonneg" CHECK ("budget_policies"."limit_usd" >= 0),
	CONSTRAINT "budget_warn_range" CHECK ("budget_policies"."warn_at_percent" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text,
	"industry" text,
	"description" text,
	"website" text,
	"logo_url" text,
	"accent_color" text,
	"primary_country" text,
	"countries_served" text[] DEFAULT '{}'::text[] NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"default_currency" text DEFAULT 'EUR' NOT NULL,
	"target_audiences" text[] DEFAULT '{}'::text[] NOT NULL,
	"target_markets" text[] DEFAULT '{}'::text[] NOT NULL,
	"products_services" text[] DEFAULT '{}'::text[] NOT NULL,
	"business_objectives" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_objective" text,
	"revenue_objective" text,
	"brand_positioning" text,
	"brand_tone" text,
	"company_rules" text[] DEFAULT '{}'::text[] NOT NULL,
	"prohibited_claims" text[] DEFAULT '{}'::text[] NOT NULL,
	"competitor_notes" text,
	"compliance_notes" text,
	"default_provider" "provider_type" DEFAULT 'CLAUDE' NOT NULL,
	"monthly_ai_budget" numeric(14, 6) DEFAULT 0 NOT NULL,
	"daily_ai_budget" numeric(14, 6) DEFAULT 0 NOT NULL,
	"concurrency_limit" integer DEFAULT 2 NOT NULL,
	"status" "company_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_budget_nonneg" CHECK ("companies"."daily_ai_budget" >= 0 AND "companies"."monthly_ai_budget" >= 0),
	CONSTRAINT "companies_concurrency_range" CHECK ("companies"."concurrency_limit" BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_company_slug_uq" UNIQUE NULLS NOT DISTINCT("company_id","slug")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"status" "integration_status" DEFAULT 'not_configured' NOT NULL,
	"auth_state" "auth_state" DEFAULT 'none' NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_ref" text,
	"last_health_check_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_kind_company_uq" UNIQUE NULLS NOT DISTINCT("kind","company_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"type" "task_type" DEFAULT 'custom' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"assigned_agent_id" uuid,
	"created_by_kind" "actor_kind" DEFAULT 'human' NOT NULL,
	"created_by_ref" text,
	"parent_task_id" uuid,
	"root_task_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"required_provider" "provider_type",
	"estimated_cost" numeric(14, 6),
	"actual_cost" numeric(14, 6),
	"progress" integer DEFAULT 0 NOT NULL,
	"current_action" text,
	"current_tool" text,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"result_summary" text,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_progress_range" CHECK ("tasks"."progress" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "agent_company_assignments" ADD CONSTRAINT "agent_company_assignments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_company_assignments" ADD CONSTRAINT "agent_company_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_template_key_agent_templates_key_fk" FOREIGN KEY ("template_key") REFERENCES "public"."agent_templates"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_reports_to_agent_id_agents_id_fk" FOREIGN KEY ("reports_to_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_root_task_id_tasks_id_fk" FOREIGN KEY ("root_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aca_company_idx" ON "agent_company_assignments" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_slug_uq" ON "agents" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_occurred_idx" ON "ai_usage_records" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "usage_company_idx" ON "ai_usage_records" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_provider_idx" ON "ai_usage_records" USING btree ("provider","occurred_at");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "audit_occurred_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_company_idx" ON "audit_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_slug_uq" ON "companies" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tasks_company_status_idx" ON "tasks" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "tasks_agent_idx" ON "tasks" USING btree ("assigned_agent_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_root_idx" ON "tasks" USING btree ("root_task_id");