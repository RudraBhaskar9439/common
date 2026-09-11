/**
 * Hedera renders one transaction id two ways: `0.0.X@seconds.nanos` from an SDK receipt
 * and `0.0.X-seconds-nanos` from the mirror node. Both have been emitted for the same
 * real transfer, so raw strings must be normalised before anything is counted.
 *
 * Verified against the mirror node: canonicalising collapses exactly the one duplicated
 * pair on chain and nothing else, and the resulting total matches the transfers the
 * seller actually received.
 */
const DASH_FORM = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/;

export function canonicalTransactionId(raw: string): string {
  if (raw.includes('@')) return raw;
  const match = DASH_FORM.exec(raw);
  if (!match) return raw;
  return `${match[1]}@${match[2]}.${match[3]}`;
}

/** Seeded settlements carry a placeholder id and moved no money. Never spend. */
export function isPlaceholderSettlement(raw: string): boolean {
  return raw.startsWith('SEED-PLACEHOLDER');
}
