import { CommonError } from '@common/interfaces';
import type { ResultStore } from '@common/interfaces';
import { CommonDatabase } from './database.js';
export { CommonDatabase } from './database.js';

/** Rudra: bind authenticated workspace identity before exposing storage operations. */
export function createResultStore(options?: { database: CommonDatabase; workspaceId: string }): ResultStore {
  if (!options?.workspaceId) throw new CommonError('UNAUTHORIZED', 'Bind authenticated workspace identity before accessing results');
  const { database, workspaceId } = options;
  const key = (reference: { workspaceId: string; id: string }) => {
    if (reference.workspaceId !== workspaceId) throw new CommonError('UNAUTHORIZED', 'Result belongs to another workspace');
    return JSON.stringify([workspaceId, reference.id]);
  };
  return {
    async put(input) {
      const id = key(input.reference);
      database.transaction(() => {
        const previous = database.get('results', id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(input)) throw new Error('Result IDs are immutable');
        database.insert('results', id, input);
      });
      return structuredClone(input.reference);
    },
    async get(reference) {
      const result = database.get<import('@common/interfaces').StoredResult>('results', key(reference));
      if (!result) throw new CommonError('NOT_FOUND', 'Result not found');
      return result;
    },
  };
}
