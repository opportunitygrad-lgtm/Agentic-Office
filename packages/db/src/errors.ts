export class NotFoundError extends Error {
  readonly code = "not_found";
  constructor(entity: string, ref: string) {
    super(`${entity} not found: ${ref}`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly code = "conflict";
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
