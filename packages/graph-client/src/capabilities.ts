/**
 * What a purchased payload can actually do, derived by inspecting it.
 *
 * WHY THIS EXISTS. The chain records *that* a result was delivered, not *what it can do*.
 * `DeliveryRecorded` has no capability field. If capabilities are a list the seller
 * asserts, then "avoid a dataset whose recorded outcome says it lacks a capability" is
 * theatre — the outcome was written by whoever wanted the sale. Deriving them from the
 * bytes makes the memory an observation instead of a claim.
 *
 * THE DISTINCTION THIS FILE TURNS ON, because conflating the two poisons the memory:
 *
 *   Delivery usability is OBJECTIVE and buyer-independent: did we receive well-formed,
 *   non-empty data? That is what `recordDelivery(usable)` should carry, and it is why the
 *   only unusable deliveries on chain are genuinely corrupt payloads.
 *
 *   Suitability is PER-BUYER: does this payload have the capability *my* task needs?
 *   That is `checkRequirement`, evaluated by each agent against the observed capability
 *   list.
 *
 * Writing `usable: false` because one buyer wanted a field the data lacks would make a
 * perfectly good result invisible to every later agent that wanted something else. The
 * capability list exists so a later agent can judge for itself.
 */

/** Every capability this module can observe, with what in the payload evidences it. */
export interface CapabilityProbe {
  capability: string;
  /** Human-readable statement of what was found, used in the recorded evidence. */
  describe: (hits: readonly string[]) => string;
  /** Field names whose presence, with non-empty values, evidences the capability. */
  fields: readonly string[];
  /** Some capabilities need more than a field name. */
  extra?: (payload: PayloadShape) => boolean;
}

export interface PayloadShape {
  /** Field names observed anywhere in the payload, lowercased. */
  fields: Set<string>;
  /** Number of records in the largest collection found. */
  rowCount: number;
  /** Distinct values seen for date-like fields, to tell a series from a snapshot. */
  distinctDates: number;
}

/**
 * Walks the payload collecting field names, row counts and date cardinality. Bounded so a
 * hostile or pathological payload cannot hang the inspection.
 */
export function describePayload(data: unknown, maxNodes = 20_000): PayloadShape {
  const fields = new Set<string>();
  const dates = new Set<string>();
  let rowCount = 0;
  let visited = 0;

  const walk = (node: unknown): void => {
    if (visited >= maxNodes || node === null || typeof node !== 'object') return;
    visited += 1;

    if (Array.isArray(node)) {
      if (node.length > rowCount) rowCount = node.length;
      for (const item of node) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      // A field present but null or empty-string evidences nothing.
      if (value !== null && value !== undefined && value !== '') fields.add(lower);
      if ((lower === 'date' || lower === 'timestamp' || lower === 'periodstarttimestamp') && value != null) {
        dates.add(String(value));
      }
      walk(value);
    }
  };
  walk(data);

  return { fields, rowCount, distinctDates: dates.size };
}

const has = (shape: PayloadShape, names: readonly string[]): string[] =>
  names.filter(n => shape.fields.has(n));

export const CAPABILITY_PROBES: readonly CapabilityProbe[] = [
  {
    capability: 'historical-data',
    fields: ['date', 'timestamp', 'periodstarttimestamp'],
    // A single dated record is a snapshot, not a history. Two or more is a series.
    extra: shape => shape.distinctDates > 1,
    describe: hits => `carries a time series over ${hits.join(', ')}`,
  },
  {
    capability: 'daily-granularity',
    fields: ['date'],
    extra: shape => shape.distinctDates > 1,
    describe: () => 'records are keyed by day',
  },
  {
    capability: 'point-in-time',
    fields: [],
    // Any non-empty payload from a block-pinned query is a snapshot of that block.
    extra: shape => shape.rowCount > 0,
    describe: () => 'pinned to a single block, so it is a point-in-time snapshot',
  },
  {
    capability: 'volume-metrics',
    fields: ['volumeusd', 'volumetoken0', 'volumetoken1'],
    describe: hits => `includes volume fields (${hits.join(', ')})`,
  },
  {
    capability: 'liquidity-metrics',
    fields: ['totalvaluelockedusd', 'liquidity'],
    describe: hits => `includes liquidity fields (${hits.join(', ')})`,
  },
  {
    capability: 'transaction-counts',
    fields: ['txcount'],
    describe: () => 'includes transaction counts',
  },
  {
    capability: 'holder-distribution',
    fields: ['holder', 'holders', 'balance', 'accounts'],
    describe: hits => `includes per-holder fields (${hits.join(', ')})`,
  },
  {
    capability: 'token-metadata',
    fields: ['symbol', 'decimals', 'name'],
    describe: hits => `includes token metadata (${hits.join(', ')})`,
  },
];

export interface DerivedCapabilities {
  capabilities: string[];
  /** Why each capability was concluded, so a recorded outcome can be audited. */
  evidence: Record<string, string>;
  rowCount: number;
}

export function deriveCapabilities(
  data: unknown,
  probes: readonly CapabilityProbe[] = CAPABILITY_PROBES,
): DerivedCapabilities {
  const shape = describePayload(data);
  const capabilities: string[] = [];
  const evidence: Record<string, string> = {};

  for (const probe of probes) {
    const hits = has(shape, probe.fields);
    const fieldsOk = probe.fields.length === 0 || hits.length > 0;
    const extraOk = probe.extra === undefined || probe.extra(shape);
    if (fieldsOk && extraOk) {
      capabilities.push(probe.capability);
      evidence[probe.capability] = probe.describe(hits);
    }
  }
  return { capabilities, evidence, rowCount: shape.rowCount };
}

/**
 * The objective delivery outcome, suitable for `recordDelivery`.
 *
 * `usable` answers only "did we receive well-formed, non-empty data". It is deliberately
 * NOT a judgement about whether the data suits any particular buyer — see the note at the
 * top of this file.
 */
export interface DeliveryAssessment {
  usable: boolean;
  capabilities: string[];
  evidence: Record<string, string>;
  rowCount: number;
  /** Set only when `usable` is false. Written to the chain verbatim. */
  failureReason?: string;
}

export function assessDelivery(payload: unknown): DeliveryAssessment {
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    return {
      usable: false, capabilities: [], evidence: {}, rowCount: 0,
      failureReason: 'provider returned no payload object',
    };
  }

  // A PinnedResult wraps the rows under `data`; a bare payload is accepted too.
  const body = 'data' in (payload as Record<string, unknown>)
    ? (payload as { data: unknown }).data
    : payload;

  if (body === null || body === undefined || typeof body !== 'object') {
    return {
      usable: false, capabilities: [], evidence: {}, rowCount: 0,
      failureReason: 'provider returned a payload with no data body',
    };
  }

  const derived = deriveCapabilities(body);
  if (derived.rowCount === 0) {
    // Well-formed but empty. Not corrupt, and not useful: a later agent should be able to
    // see that this key returns nothing at this block rather than buy it again.
    return {
      usable: false,
      capabilities: derived.capabilities,
      evidence: derived.evidence,
      rowCount: 0,
      failureReason: 'provider returned a well-formed but empty result set',
    };
  }

  return {
    usable: true,
    capabilities: derived.capabilities,
    evidence: derived.evidence,
    rowCount: derived.rowCount,
  };
}

export interface RequirementCheck {
  satisfied: boolean;
  required: readonly string[];
  observed: readonly string[];
  missing: string[];
  explanation: string;
}

/**
 * Whether an observed capability list covers what a task needs.
 *
 * This is the per-buyer half, and the reason a later agent can avoid a purchase whose
 * recorded outcome shows it lacks what that agent needs — without the result being marked
 * broken for everyone else.
 */
export function checkRequirement(
  observed: readonly string[],
  required: readonly string[],
): RequirementCheck {
  const missing = required.filter(r => !observed.includes(r));
  return {
    satisfied: missing.length === 0,
    required,
    observed,
    missing,
    explanation: missing.length === 0
      ? `Suitable: the result provides ${required.length === 0 ? 'no specific capability was required' : required.join(', ')}.`
      : `Unsuitable for this task: missing ${missing.join(', ')}. Observed: ${observed.length > 0 ? observed.join(', ') : 'none'}.`,
  };
}
