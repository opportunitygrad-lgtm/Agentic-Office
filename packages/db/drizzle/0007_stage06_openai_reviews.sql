CREATE TYPE "public"."provider_selection_mode" AS ENUM('fixed', 'auto');--> statement-breakpoint
CREATE TYPE "public"."run_purpose" AS ENUM('primary', 'second_opinion', 'quality_review', 'future_tool_run');--> statement-breakpoint
CREATE TYPE "public"."second_opinion_mode" AS ENUM('off', 'manual', 'policy_required', 'high_value_only');--> statement-breakpoint
CREATE TABLE "agent_run_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewed_run_id" uuid NOT NULL,
	"reviewer_run_id" uuid NOT NULL,
	"reviewer_provider" "provider_type" NOT NULL,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_reviews_reviewer_run_id_unique" UNIQUE("reviewer_run_id")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "run_purpose" "run_purpose" DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "reviewed_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "preferred_reviewer_provider" "provider_type";--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "provider_selection" "provider_selection_mode" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "review_mode" "second_opinion_mode" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "review_provider" "provider_type";--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "review_task_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "high_value_threshold_usd" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "company_ai_policies" ADD COLUMN "max_reviews_per_task" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run_reviews" ADD CONSTRAINT "agent_run_reviews_reviewed_run_id_agent_runs_id_fk" FOREIGN KEY ("reviewed_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_reviews" ADD CONSTRAINT "agent_run_reviews_reviewer_run_id_agent_runs_id_fk" FOREIGN KEY ("reviewer_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_reviews" ADD CONSTRAINT "agent_run_reviews_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_run_reviews_reviewed_idx" ON "agent_run_reviews" USING btree ("reviewed_run_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_reviews_reviewer_provider_idx" ON "agent_run_reviews" USING btree ("reviewed_run_id","reviewer_provider");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_reviewed_run_id_agent_runs_id_fk" FOREIGN KEY ("reviewed_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_reviewed_idx" ON "agent_runs" USING btree ("reviewed_run_id");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_purpose" CHECK ("agent_runs"."run_purpose" <> 'second_opinion' or "agent_runs"."reviewed_run_id" is not null);