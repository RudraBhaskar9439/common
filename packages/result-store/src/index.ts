import { CommonError } from '@common/interfaces';
import type { ResultStore } from '@common/interfaces';

/** Rudra: bind authenticated workspace identity before exposing storage operations. */
export function createResultStore(): ResultStore {
  throw new CommonError('NOT_IMPLEMENTED', 'Persistent authorized result storage is not implemented.');
}
