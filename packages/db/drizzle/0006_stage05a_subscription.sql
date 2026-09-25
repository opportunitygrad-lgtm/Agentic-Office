ALTER TYPE "public"."provider_health_state" ADD VALUE 'not_installed';--> statement-breakpoint
ALTER TYPE "public"."provider_health_state" ADD VALUE 'login_required';--> statement-breakpoint
ALTER TYPE "public"."provider_health_state" ADD VALUE 'login_expired';--> statement-breakpoint
ALTER TYPE "public"."provider_health_state" ADD VALUE 'misconfigured';--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "transport" text DEFAULT 'anthropic_api' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "billing_mode" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "api_equivalent_cost" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "premium_available" boolean;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "rate_limit" jsonb;--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN "cli_info" jsonb;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD COLUMN "billing_mode" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD COLUMN "api_equivalent_cost" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD COLUMN "rate_limit" jsonb;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_billing_mode" CHECK ("agent_runs"."billing_mode" in ('subscription','api','none') and ("agent_runs"."billing_mode" <> 'subscription' or ("agent_runs"."actual_cost" is null and "agent_runs"."reserved_cost" = 0)));--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "usage_billing_mode" CHECK ("ai_usage_records"."billing_mode" in ('subscription','api','none') and ("ai_usage_records"."billing_mode" <> 'subscription' or ("ai_usage_records"."actual_cost" = 0 and "ai_usage_records"."provider_cost" = 0)));