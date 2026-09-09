import { CommonError } from '@common/interfaces';
import type { SpendingAdapter } from '@common/interfaces';

/** Kavish: implement verified payment and reservation behavior behind this boundary. */
export function createHederaSpendingAdapter(): SpendingAdapter {
  throw new CommonError('NOT_IMPLEMENTED', 'Live Hedera adapter is not implemented. No transaction was submitted.');
}
