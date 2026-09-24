import { z } from "zod";
import {
  AUTONOMY_LEVELS,
  GRANT_EFFECT_VALUES,
  MEMBERSHIP_STATUSES,
  ROLE_SCOPES,
  USER_STATUSES,
} from "./enums";

/** Emails are compared in normalised (trimmed, lower-case) form. */
export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email("Enter a valid email address"))
  .transform((v) => v.toLowerCase());

export const PASSWORD_MIN_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
  "password1234",
  "123456789012",
  "qwertyuiop12",
  "passwordpassword",
  "letmein12345",
  "welcome12345",
  "iloveyou1234",
  "adminadmin12",
]);

/**
 * Password policy (NIST SP 800-63B style): length over composition rules,
 * 12–128 characters, not a known-common password.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, "Password must be at most 128 characters")
  .refine((v) => v.trim().length >= PASSWORD_MIN_LENGTH, "Password cannot be mostly whitespace")
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), "This password is too common");

export const loginSchema = z.object({
  email: emailSchema,
  /** Not policy-validated on login (legacy passwords must still be checkable). */
  password: z.string().min(1, "Password is required").max(256),
});

export const passwordResetRequestSchema = z.object({ email: emailSchema });

export const tokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{32,128}$/, "Invalid token");

export const passwordResetConfirmSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

export const acceptInvitationSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
});

export const membershipInputSchema = z.object({
  /** null = global membership (all companies). */
  companyId: z.uuid().nullable(),
  roleId: z.uuid(),
  departmentIds: z.array(z.uuid()).max(50).default([]),
});

export const inviteUserSchema = z
  .object({
    email: emailSchema,
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().max(80).optional(),
    memberships: z
      .array(membershipInputSchema)
      .min(1, "At least one membership is required")
      .max(50),
  })
  .strict();

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().max(80).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    status: z.enum(USER_STATUSES).exclude(["invited"]).optional(),
  })
  .strict();

export const updateMembershipSchema = z
  .object({
    roleId: z.uuid().optional(),
    status: z.enum(MEMBERSHIP_STATUSES).exclude(["invited"]).optional(),
    departmentIds: z.array(z.uuid()).max(50).optional(),
  })
  .strict();

export const roleKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Key must be lowercase snake_case");

export const createRoleSchema = z
  .object({
    name: z.string().trim().min(2, "Role name is required").max(80),
    description: z.string().trim().max(500).optional(),
    scope: z.enum(ROLE_SCOPES).default("company"),
    /** Company-specific custom role (null/absent = available to all companies). */
    companyId: z.uuid().nullable().optional(),
    permissions: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
  })
  .strict();

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    permissions: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  })
  .strict();

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export const agentAutonomySchema = z.object({ autonomyLevel: z.enum(AUTONOMY_LEVELS) }).strict();

export const agentGrantsSchema = z
  .object({
    /** null = applies to every company the agent serves. */
    companyId: z.uuid().nullable().default(null),
    grants: z
      .array(
        z
          .object({
            permission: z.string().trim().min(1).max(80),
            effect: z.enum(GRANT_EFFECT_VALUES).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
