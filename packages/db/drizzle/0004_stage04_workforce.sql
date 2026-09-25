CREATE TYPE "public"."agent_message_type" AS ENUM('task_instruction', 'handoff', 'status', 'question', 'escalation', 'approval_notice', 'system');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."delegation_outcome" AS ENUM('handle_self', 'delegate_to_agent', 'delegate_to_team', 'create_temporary_worker', 'require_human_review', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."handoff_status" AS ENUM('pending', 'accepted', 'rejected', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."handoff_type" AS ENUM('research_result', 'work_transfer', 'review_request', 'escalation', 'information');--> statement-breakpoint
ALTER TYPE "public"."agent_status" ADD VALUE 'expired';--> statement-breakpoint
ALTER TYPE "public"."agent_status" ADD VALUE 'terminated';--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"sender_type" "actor_type" NOT NULL,
	"sender_agent_id" uuid,
	"sender_user_id" uuid,
	"sender_service_id" text,
	"recipient_agent_id" uuid,
	"recipient_team_id" uuid,
	"task_id" uuid,
	"type" "agent_message_type" NOT NULL,
	"content" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_messages_one_recipient" CHECK (num_nonnulls("agent_messages"."recipient_agent_id", "agent_messages"."recipient_team_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "agent_role_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"role" jsonb NOT NULL,
	"change_summary" text NOT NULL,
	"material" boolean DEFAULT true NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_role_versions_uq" UNIQUE("agent_id","version")
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"author_user_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_role" CHECK ("conversation_messages"."role" in ('human', 'agent', 'system'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"title" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"source_agent_id" uuid NOT NULL,
	"to_agent_id" uuid,
	"to_team_id" uuid,
	"to_department_id" uuid,
	"type" "handoff_type" DEFAULT 'work_transfer' NOT NULL,
	"objective" text NOT NULL,
	"summary" text NOT NULL,
	"verified_facts" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_references" text[] DEFAULT '{}'::text[] NOT NULL,
	"knowledge_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"contact_reference" text,
	"action_required" text NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"deadline" timestamp with time zone,
	"do_not_research_again_unless" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "handoff_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoffs_one_destination" CHECK (num_nonnulls("handoffs"."to_agent_id", "handoffs"."to_team_id", "handoffs"."to_department_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "role_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"company_id" uuid,
	"base_template_key" text NOT NULL,
	"name" text NOT NULL,
	"department_slug" text NOT NULL,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"role" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_templates_key_uq" UNIQUE NULLS NOT DISTINCT("company_id","key")
);
--> statement-breakpoint
CREATE TABLE "task_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"company_id" uuid,
	"from_agent_id" uuid,
	"to_agent_id" uuid,
	"to_team_id" uuid,
	"outcome" "delegation_outcome" NOT NULL,
	"override" boolean DEFAULT false NOT NULL,
	"reason" text,
	"explanation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_by_user_id" uuid,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_agent_id_pk" PRIMARY KEY("team_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"department_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"purpose" text,
	"leader_agent_id" uuid,
	"concurrency_limit" integer DEFAULT 3 NOT NULL,
	"default_task_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_temporary" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_company_slug_uq" UNIQUE NULLS NOT DISTINCT("company_id","slug"),
	CONSTRAINT "teams_concurrency_range" CHECK ("teams"."concurrency_limit" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "workforce_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"global_active_agent_limit" integer DEFAULT 3 NOT NULL,
	"max_delegation_depth" integer DEFAULT 3 NOT NULL,
	"high_cost_task_threshold_usd" numeric(14, 6) DEFAULT 5 NOT NULL,
	"temp_agent_max_expiry_hours" integer DEFAULT 168 NOT NULL,
	"temp_agent_approval_budget_usd" numeric(14, 6) DEFAULT 2 NOT NULL,
	"max_active_temp_agents_per_company" integer DEFAULT 10 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workforce_policy_singleton" CHECK ("workforce_policy"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "agent_templates" ADD COLUMN "agent_capabilities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "capabilities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "escalation_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "fallback_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "role_template_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "parent_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "bound_task_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "may_spawn_temporary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "terminated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "mission" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "manager_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "human_manager_user_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "default_provider" "provider_type";--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "concurrency_limit" integer;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "daily_budget_usd" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "instructions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "allowed_task_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "handoff_destinations" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "required_capabilities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "preferred_department_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "preferred_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "preferred_team_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "provider_preference" "provider_type";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_budget" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_concurrency" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delegation_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parallel_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_action_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "approval_requirements" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "result_schema" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "stopping_condition" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "expected_outcome" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "target_entity" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "work_items" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "normalized_objective" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delegation_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delegated_from_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claimed_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_sender_agent_id_agents_id_fk" FOREIGN KEY ("sender_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_recipient_agent_id_agents_id_fk" FOREIGN KEY ("recipient_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_recipient_team_id_teams_id_fk" FOREIGN KEY ("recipient_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_versions" ADD CONSTRAINT "agent_role_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_versions" ADD CONSTRAINT "agent_role_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_versions" ADD CONSTRAINT "agent_role_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_to_team_id_teams_id_fk" FOREIGN KEY ("to_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_base_template_key_agent_templates_key_fk" FOREIGN KEY ("base_template_key") REFERENCES "public"."agent_templates"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_delegations" ADD CONSTRAINT "task_delegations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_delegations" ADD CONSTRAINT "task_delegations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_delegations" ADD CONSTRAINT "task_delegations_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_delegations" ADD CONSTRAINT "task_delegations_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_delegations" ADD CONSTRAINT "task_delegations_to_team_id_teams_id_fk" FOREIGN KEY ("to_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_delegations" ADD CONSTRAINT "task_delegations_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_agent_id_agents_id_fk" FOREIGN KEY ("leader_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_policy" ADD CONSTRAINT "workforce_policy_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_recipient_idx" ON "agent_messages" USING btree ("recipient_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_messages_task_idx" ON "agent_messages" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_role_current_uq" ON "agent_role_versions" USING btree ("agent_id") WHERE is_current;--> statement-breakpoint
CREATE INDEX "conversation_messages_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id","agent_id");--> statement-breakpoint
CREATE INDEX "handoffs_task_idx" ON "handoffs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "handoffs_to_agent_idx" ON "handoffs" USING btree ("to_agent_id","status");--> statement-breakpoint
CREATE INDEX "task_delegations_task_idx" ON "task_delegations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_delegations_company_idx" ON "task_delegations" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "team_members_agent_idx" ON "team_members" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_escalation_agent_id_agents_id_fk" FOREIGN KEY ("escalation_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_fallback_manager_id_agents_id_fk" FOREIGN KEY ("fallback_manager_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_role_template_id_role_templates_id_fk" FOREIGN KEY ("role_template_id") REFERENCES "public"."role_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_bound_task_id_tasks_id_fk" FOREIGN KEY ("bound_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_agent_id_agents_id_fk" FOREIGN KEY ("manager_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_human_manager_user_id_users_id_fk" FOREIGN KEY ("human_manager_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_preferred_department_id_departments_id_fk" FOREIGN KEY ("preferred_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_preferred_agent_id_agents_id_fk" FOREIGN KEY ("preferred_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_preferred_team_id_teams_id_fk" FOREIGN KEY ("preferred_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_delegated_from_agent_id_agents_id_fk" FOREIGN KEY ("delegated_from_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_claimed_by_agent_id_agents_id_fk" FOREIGN KEY ("claimed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_objective_idx" ON "tasks" USING btree ("company_id","normalized_objective");--> statement-breakpoint
CREATE INDEX "tasks_claim_idx" ON "tasks" USING btree ("claimed_by_agent_id");--> statement-breakpoint
-- Default workforce policy (singleton row).
INSERT INTO "workforce_policy" ("id") VALUES (1) ON CONFLICT DO NOTHING;
