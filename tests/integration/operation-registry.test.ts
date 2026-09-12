import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommonDatabase } from '@common/result-store';
import { createPersistentOperationRegistry } from '@common/orchestrator';

test('payment terms and signed transaction identity survive restart without losing integer precision', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'common-operation-'));
  let db = new CommonDatabase(join(dir, 'db.sqlite'));
  try {
    const input = { workspaceId: 'a', purchaseKey: 'p', amount: 9007199254740993n, asset: '0.0.0', payTo: '0.0.10', resource: 'http://localhost/job', agentId: 'agent-a', reservedAt: 100, expiresAt: 300, transfer: { transactionId: '0.0.20@101.000000001', validUntilEpochSeconds: 221 } };
    createPersistentOperationRegistry(db).remember('operation', input);
    db.close(); db = new CommonDatabase(join(dir, 'db.sqlite'));
    assert.deepEqual(createPersistentOperationRegistry(db).recall('operation'), input);
    assert.equal(createPersistentOperationRegistry(db).recall('missing'), undefined);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
