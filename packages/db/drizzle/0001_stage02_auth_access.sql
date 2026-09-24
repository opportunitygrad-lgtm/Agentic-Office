CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent', 'service', 'system', 'anonymous');--> statement-breakpoint
CREATE TYPE "public"."agent_autonomy" AS ENUM('disabled', 'observe', 'limited_operator', 'approval_gated', 'trusted_automation');--> statement-breakpoint
CREATE TYPE "public"."auth_token_type" AS ENUM('password_reset', 'invitation');--> statement-breakpoint
CREATE TYPE "public"."grant_effect" AS ENUM('allow', 'require_approval', 'deny');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('global', 'company');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended', 'disabled');--> statement-breakpoint
CREATE TABLE "agent_permission_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"company_id" uuid,
	"permission" text NOT NULL,
	"effect" "grant_effect" NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_grants_uq" UNIQUE NULLS NOT DISTINCT("agent_id","company_id","permission")
);
--> statement-breakpoint
CREATE TABLE "approval_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_type" text NOT NULL,
	"min_risk_level" "risk_level",
	"required_permission" text NOT NULL,
	"company_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_req_uq" UNIQUE NULLS NOT DISTINCT("approval_type","min_risk_level","required_permission","company_id")
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "auth_token_type" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"role_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"joined_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_company_uq" UNIQUE NULLS NOT DISTINCT("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "membership_departments" (
	"membership_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	CONSTRAINT "membership_departments_membership_id_department_id_pk" PRIMARY KEY("membership_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"scope" "role_scope" DEFAULT 'company' NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"scope" "role_scope" DEFAULT 'company' NOT NULL,
	"company_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_identities" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"auth_level" text DEFAULT 'password' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"display_name" text,
	"avatar_url" text,
	"password_hash" text,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"timezone" text,
	"locale" text,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"origin" "data_origin" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_templates" ADD COLUMN "autonomy" "agent_autonomy" DEFAULT 'observe' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "autonomy" "agent_autonomy" DEFAULT 'observe' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "required_permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_type" "actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_service_id" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "resource_type" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "resource_id" text;--> statement-breakpoint
ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD CONSTRAINT "approval_requirements_required_permission_permissions_key_fk" FOREIGN KEY ("required_permission") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requirements" ADD CONSTRAINT "approval_requirements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_departments" ADD CONSTRAINT "membership_departments_membership_id_company_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."company_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_departments" ADD CONSTRAINT "membership_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "memberships_company_idx" ON "company_memberships" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_uq" ON "users" USING btree ("email_normalized");--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_service_id_service_identities_key_fk" FOREIGN KEY ("actor_service_id") REFERENCES "public"."service_identities"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_actor_user_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
-- Stage 02 data migration: map the Stage 01 autonomy vocabulary onto the formal L0–L4 ladder.
UPDATE "agents" SET "autonomy" = (CASE "autonomy_level"::text
  WHEN 'observe' THEN 'observe' WHEN 'suggest' THEN 'observe'
  WHEN 'act_with_approval' THEN 'approval_gated' WHEN 'autonomous_limited' THEN 'limited_operator'
  WHEN 'autonomous' THEN 'trusted_automation' END)::"agent_autonomy";--> statement-breakpoint
UPDATE "agent_templates" SET "autonomy" = (CASE "default_autonomy"::text
  WHEN 'observe' THEN 'observe' WHEN 'suggest' THEN 'observe'
  WHEN 'act_with_approval' THEN 'approval_gated' WHEN 'autonomous_limited' THEN 'limited_operator'
  WHEN 'autonomous' THEN 'trusted_automation' END)::"agent_autonomy";
