import { CommonError } from '@common/interfaces';
import type { MemoryReader } from '@common/interfaces';

/** Aditya: replace this explicit stub with live Graph provider queries. */
export function createGraphMemoryReader(): MemoryReader {
  throw new CommonError('NOT_IMPLEMENTED', 'Live Graph client is not implemented. Use @common/mocks for development.');
}
