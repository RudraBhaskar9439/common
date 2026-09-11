/**
 * Transport and protocol failures for the Graph read layer.
 *
 * `ErrorCode` in `@common/interfaces` has no code for "the index could not be reached"
 * or "the index answered with an error". Rather than misreport a network failure as
 * NOT_FOUND — which a caller could read as "nothing was purchased" and act on — these
 * are their own class. Proposal to add transport codes to the shared union is recorded in
 * docs/workstreams/aditya.md.
 *
 * A caller must never treat either of these as permission to buy.
 */
export class GraphUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GraphUnavailableError';
  }
}

/** The endpoint answered, but with GraphQL errors. */
export class GraphQueryError extends Error {
  constructor(message: string, readonly errors: readonly { message: string }[]) {
    super(message);
    this.name = 'GraphQueryError';
  }
}
