import { createHash } from 'node:crypto';
import { canonicalEvaluationSpec } from '@common/interfaces';

export function evaluationSpecHash(spec: unknown): string {
  return createHash('sha256').update(canonicalEvaluationSpec(spec)).digest('hex');
}

/** Discovery identity only. Workspace authorization and contract reservation remain mandatory. */
export function evaluationPurchaseKey(spec: unknown): string {
  return `evaluation:v1:${evaluationSpecHash(spec)}`;
}
