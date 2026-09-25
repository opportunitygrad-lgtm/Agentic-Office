CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'preparing', 'routing', 'running', 'streaming', 'waiting', 'completed', 'failed', 'cancel_requested', 'cancelled', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."effort_level" AS ENUM('low', 'medium', 'high', 'xhigh', 'max');--> statement-breakpoint
CREATE TYPE "public"."model_tier" AS ENUM('standard', 'premium', 'auto');--> statement-breakpoint
CREATE TYPE "public"."provider_health_state" AS ENUM('not_configured', 'available', 'degraded', 'rate_limited', 'auth_error', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."response_detail" AS ENUM('short', 'normal', 'detailed', 'custom');--> statement-breakpoint
CREATE TYPE "public"."run_execution_type" AS ENUM('task', 'chat', 'connection_test');--> statement-breakpoint
CREATE TABLE "agent_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"detail" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_events_seq_uq" UNIQUE("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "agent_run_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_feedback_uq" UNIQUE("run_id","user_id"),
	CONSTRAINT "agent_run_feedback_rating" CHECK ("agent_run_feedback"."rating" in ('useful','not_useful'))
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer DEFAULT 1 NOT NULL,
	"execution_type" "run_execution_type" NOT NULL,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"company_id" uuid,
	"task_id" uuid,
	"agent_id" uuid,
	"conversation_id" uuid,
	"provider" "provider_type" NOT NULL,
	"model" text NOT NULL,
	"effort" "effort_level",
	"tier" "model_tier" DEFAULT 'standard' NOT NULL,
	"response_detail" "response_detail" DEFAULT 'normal' NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"timeout_ms" integer NOT NULL,
	"max_retries" integer DEFAULT 1 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"started_by_user_id" uuid,
	"idempotency_key" text,
	"viewer_max_sensitivity" text DEFAULT 'internal' NOT NULL,
	"route_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"context_version" text,
	"instruction_version" text,
	"context_summary" jsonb,
	"provider_request_id" text,
	"provider_call_started_at" timestamp with time zone,
	"response_saved_at" timestamp with time zone,
	"output_text" text DEFAULT '' NOT NULL,
	"result" jsonb,
	"stop_reason" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_creation_tokens" integer,
	"cache_read_tokens" integer,
	"estimated_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
	"reserved_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
	"reservation_status" text DEFAULT 'none' NOT NULL,
	"actual_cost" numeric(14, 6),
	"price_snapshot" jsonb,
	"latency_ms" integer,
	"error_code" text,
	"error_message" text,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	CONSTRAINT "agent_runs_reservation" CHECK ("agent_runs"."reservation_status" in ('none','active','settled','released'))
);
--> statement-breakpoint
CREATE TABLE "ai_model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider_type" NOT NULL,
	"model" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"input_per_mtok" numeric(14, 6) NOT NULL,
	"output_per_mtok" numeric(14, 6) NOT NULL,
	"cache_write_per_mtok" numeric(14, 6) NOT NULL,
	"cache_read_per_mtok" numeric(14, 6) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_prices_uq" UNIQUE("provider","model","effective_from"),
	CONSTRAINT "ai_model_prices_nonneg" CHECK ("ai_model_prices"."input_per_mtok" >= 0 AND "ai_model_prices"."output_per_mtok" >= 0 AND "ai_model_prices"."cache_write_per_mtok" >= 0 AND "ai_model_prices"."cache_read_per_mtok" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_provider_settings" (
	"provider" "provider_type" PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"standard_model" text,
	"premium_model" text,
	"standard_effort" "effort_level",
	"premium_effort" "effort_level",
	"daily_budget_usd" numeric(14, 6),
	"health_state" "provider_health_state" DEFAULT 'not_configured' NOT NULL,
	"health_detail" text,
	"last_health_check_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "preferred_model_tier" "model_tier" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "default_effort" "effort_level";--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD COLUMN "cache_creation_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD COLUMN "price_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "default_model_tier" "model_tier" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "premium_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "max_response_detail" "response_detail" DEFAULT 'detailed' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "fallback_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "provider" "provider_type";--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "model_tier" "model_tier";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "response_detail" "response_detail" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "high_complexity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workforce_policy" ADD COLUMN "global_daily_ai_budget_usd" numeric(14, 6) DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_feedback" ADD CONSTRAINT "agent_run_feedback_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_feedback" ADD CONSTRAINT "agent_run_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD CONSTRAINT "ai_provider_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_task_idx" ON "agent_runs" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_company_idx" ON "agent_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_active_task" ON "agent_runs" USING btree ("task_id") WHERE "agent_runs"."task_id" is not null and "agent_runs"."status" in ('queued','preparing','routing','running','streaming','waiting','cancel_requested');--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_one_active_conversation" ON "agent_runs" USING btree ("conversation_id") WHERE "agent_runs"."conversation_id" is not null and "agent_runs"."status" in ('queued','preparing','routing','running','streaming','waiting','cancel_requested');--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_idempotency_uq" ON "agent_runs" USING btree ("idempotency_key") WHERE "agent_runs"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;