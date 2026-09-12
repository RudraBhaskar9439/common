import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommonDatabase, createResultStore } from '../src/index.js';

test('stored results survive reopen and cannot cross workspace boundaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'common-db-'));
  const path = join(dir, 'common.sqlite');
  let db = new CommonDatabase(path);
  try {
    const reference = { id: 'same-id', workspaceId: 'a' };
    await createResultStore({ database: db, workspaceId: 'a' }).put({ reference, content: { answer: 42 } });
    db.close(); db = new CommonDatabase(path);
    const a = createResultStore({ database: db, workspaceId: 'a' });
    assert.deepEqual((await a.get(reference)).content, { answer: 42 });
    await assert.rejects(createResultStore({ database: db, workspaceId: 'b' }).get(reference), { code: 'UNAUTHORIZED' });
    await assert.rejects(a.put({ reference, content: { answer: 99 } }), /immutable/);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('claim insertion is unique across two connections and transactions roll back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'common-claims-'));
  const db = new CommonDatabase(join(dir, 'shared.sqlite'));
  const other = new CommonDatabase(join(dir, 'shared.sqlite'));
  try {
    assert.equal(db.insert('claims', 'key', { operationId: 'one' }), true);
    assert.equal(other.insert('claims', 'key', { operationId: 'two' }), false);
    assert.throws(() => db.transaction(() => { db.set('claims', 'rollback', 1); throw new Error('stop'); }));
    assert.equal(db.get('claims', 'rollback'), undefined);
  } finally { db.close(); other.close(); await rm(dir, { recursive: true, force: true }); }
});
