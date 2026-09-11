import { id as keccakUtf8 } from 'ethers';

/**
 * The contract stores keccak256(utf8(label)) — `toId` in the Hedera adapter. Hashing is
 * one-way, so a label cannot be recovered from an indexed identifier.
 *
 * Two consequences the client has to handle rather than hide:
 *
 *  - To query by a human identifier, hash it. Deterministic and cheap.
 *  - To *return* one, the plaintext must come from somewhere else. Where the caller
 *    supplied it we echo it back; where it came from a verified HCS note we use that;
 *    otherwise the hex is returned and labelled, never guessed.
 */
export function toIndexedId(label: string): string {
  return keccakUtf8(label);
}

/** True when `value` is already a 32-byte hex identifier rather than a label. */
export function isIndexedId(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Accepts either a label or an already-hashed id, and returns the id to query with.
 * Lets a caller hand back an identifier we previously returned as hex.
 */
export function resolveQueryId(value: string): string {
  return isIndexedId(value) ? value.toLowerCase() : toIndexedId(value);
}

/** Confirms a plaintext label really is the preimage of an indexed identifier. */
export function verifyPreimage(label: string, indexedId: string): boolean {
  return toIndexedId(label).toLowerCase() === indexedId.toLowerCase();
}

/**
 * Presents an identifier for which no preimage is known. Marked so it cannot be mistaken
 * for a name, and so a consumer comparing it to a label fails loudly rather than quietly.
 */
export function unresolvedId(indexedId: string): string {
  return indexedId.toLowerCase();
}
