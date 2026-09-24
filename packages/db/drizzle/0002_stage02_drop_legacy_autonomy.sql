ALTER TABLE "agent_templates" DROP COLUMN "default_autonomy";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "autonomy_level";--> statement-breakpoint
DROP TYPE "public"."autonomy_level";