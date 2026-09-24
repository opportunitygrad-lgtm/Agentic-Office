import type { AuthState, IntegrationKind, IntegrationStatus } from "@aibos/shared";

export interface IntegrationContext {
  integrationId: string;
  companyId: string | null;
  /** Opaque reference into the future secret store. Never a secret value. */
  credentialRef: string | null;
}

export interface IntegrationHealth {
  status: IntegrationStatus;
  authState: AuthState;
  checkedAt: Date;
  error?: string;
}

/**
 * Contract for every live integration adapter. Each adapter action must emit
 * an audit event and pass through the approval engine when required.
 */
export interface IntegrationAdapter {
  readonly kind: IntegrationKind;
  healthCheck(ctx: IntegrationContext): Promise<IntegrationHealth>;
  sync?(ctx: IntegrationContext): Promise<{ syncedAt: Date; items: number }>;
}

/** Stage 01 placeholder: reports "not_configured" and performs no I/O. */
export class PlaceholderIntegrationAdapter implements IntegrationAdapter {
  constructor(readonly kind: IntegrationKind) {}

  async healthCheck(): Promise<IntegrationHealth> {
    return { status: "not_configured", authState: "none", checkedAt: new Date() };
  }
}
