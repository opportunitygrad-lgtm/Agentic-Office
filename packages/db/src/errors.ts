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

export class ForbiddenError extends Error {
  readonly code = "forbidden";
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Invalid, expired or already-used single-use token — deliberately indistinguishable. */
export class InvalidTokenError extends Error {
  readonly code = "invalid_token";
  constructor() {
    super("This link is invalid or has expired");
    this.name = "InvalidTokenError";
  }
}
