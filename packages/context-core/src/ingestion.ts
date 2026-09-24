import type { CreateKnowledgeInput, KnowledgeSourceType } from "@aibos/shared";

/**
 * FUTURE CONTRACT — no implementation in Stage 03.
 *
 * Every future knowledge source (uploaded files, Outlook, Google Drive/Sheets,
 * websites, Meta, WordPress, web/Claude/OpenAI/Grok research) turns raw input
 * into DRAFT knowledge through this contract. Adapters never approve anything:
 * their output enters the lifecycle as `draft` (and AI-produced content as
 * `unverified`) until a human approves it.
 */
export type IngestionSourceKind =
  | "uploaded_file"
  | "outlook_email"
  | "google_drive"
  | "google_sheet"
  | "website"
  | "meta"
  | "wordpress"
  | "web_research"
  | "claude_research"
  | "openai_research"
  | "grok_research";

export interface IngestionInput {
  companyId: string | null;
  kind: IngestionSourceKind;
  /** Opaque reference to the raw source (file id, message id, URL...). */
  reference: string;
  /** Who/what triggered ingestion (user id, service key, agent id). */
  requestedBy: { type: "human" | "agent" | "service"; id: string };
}

export interface NormalizedDocument {
  title: string;
  text: string;
  mimeType: string | null;
  sourceUrl: string | null;
  capturedAt: Date;
}

export interface ExtractedMetadata {
  sourceType: KnowledgeSourceType;
  sourceOwner: string | null;
  suggestedType: CreateKnowledgeInput["type"];
  suggestedTags: string[];
  effectiveAt: Date | null;
  expiresAt: Date | null;
}

export interface KnowledgeIngestionAdapter {
  readonly kind: IngestionSourceKind;
  /** Fetch/receive the raw source. */
  ingest(input: IngestionInput): Promise<{ raw: unknown }>;
  /** Convert raw input into clean text. */
  normalize(raw: unknown): Promise<NormalizedDocument>;
  extractMetadata(doc: NormalizedDocument): Promise<ExtractedMetadata>;
  /** Produce a DRAFT knowledge payload for human review (never approved). */
  createKnowledgeDraft(
    input: IngestionInput,
    doc: NormalizedDocument,
    meta: ExtractedMetadata,
  ): Promise<CreateKnowledgeInput>;
}
