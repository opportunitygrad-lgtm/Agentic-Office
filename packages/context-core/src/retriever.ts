import type { KnowledgeCandidate } from "./types";

/**
 * Candidate generation for the Context Engine. Implementations return the
 * knowledge a pack MAY use (company-scoped + GLOBAL only); the engine then
 * applies lifecycle, freshness, sensitivity, relevance and budget rules.
 *
 * Stage 03 ships a deterministic Postgres implementation (`@aibos/db`).
 * Future implementations (embeddings / vector search) plug in here without
 * changing the engine — and must keep the same company isolation guarantee.
 */
export interface RetrievalQuery {
  companyId: string;
  /** Always-included ids (task/agent links, explicit requests). */
  explicitIds: readonly string[];
  /** Free-text hint built from the task (title, description). */
  text: string;
  limit: number;
}

export interface KnowledgeRetriever {
  readonly name: string;
  retrieve(query: RetrievalQuery): Promise<KnowledgeCandidate[]>;
}

/** In-memory retriever over a fixed list — used by tests and tooling. */
export class InMemoryKnowledgeRetriever implements KnowledgeRetriever {
  readonly name = "in-memory";
  constructor(private readonly items: readonly KnowledgeCandidate[]) {}

  async retrieve(q: RetrievalQuery): Promise<KnowledgeCandidate[]> {
    const explicit = new Set(q.explicitIds);
    return this.items
      .filter(
        (k) =>
          k.companyId === q.companyId ||
          (k.scope === "global" && k.companyId === null) ||
          // Explicit ids are returned even across companies so the engine can
          // report (and block) them; the engine never lets them into a pack.
          explicit.has(k.id),
      )
      .slice(0, q.limit);
  }
}
