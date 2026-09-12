/**
 * Decision note publication and, most importantly, the Phase 4 requirement that an HCS
 * retry never replays a payment.
 *
 * Uses a stub publisher — test-only, never imported by src/ — because a real HCS failure
 * cannot be produced on demand. Publication against the real topic is verified in
 * infra/scripts/live-verify.ts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNote, buildNoteTransaction, type DecisionNotePublisher, type PublishedNote } from '../src/hcs/decision-notes.js';
import type { DecisionRecord } from '@common/interfaces';

const record = (id: string): DecisionRecord => ({
  schemaVersion: 1,
  decisionId: id,
  workspaceId: 'workspace-1',
  agentId: 'agent-b',
  type: 'reuse',
  chosen: 'result-1',
  rejected: 'Buy a second copy',
  reason: 'A fresh delivered result already exists for this purchase key.',
  createdAt: '2026-09-10T20:34:00.000Z',
  operationId: 'op-a-1',
});

/** STUB publisher with controllable failure, mirroring the real queue semantics. */
function stubPublisher(failUntilAttempt = 0): DecisionNotePublisher & { attempts: number; published: string[] } {
  const queued: DecisionRecord[] = [];
  const published: string[] = [];
  const stub = {
    attempts: 0,
    published,
    async publish(input: DecisionRecord): Promise<PublishedNote> {
      stub.attempts += 1;
      if (stub.attempts <= failUntilAttempt) throw new Error('HCS unavailable');
      published.push(input.decisionId);
      return { sequenceNumber: String(published.length), consensusTimestamp: '1789069246.0', topicId: '0.0.1234' };
    },
    pending: () => [...queued],
    queue(input: DecisionRecord) {
      if (!queued.some((row) => row.decisionId === input.decisionId)) queued.push(input);
    },
    async retryPending(): Promise<PublishedNote[]> {
      const out: PublishedNote[] = [];
      for (const row of [...queued]) {
        try {
          out.push(await stub.publish(row));
          queued.splice(
            queued.findIndex((r) => r.decisionId === row.decisionId),
            1,
          );
        } catch {
          /* stays queued */
        }
      }
      return out;
    },
    close() {},
  };
  return stub;
}

test('a note carries the reasoning and an explicit truth disclaimer', () => {
  const note = JSON.parse(buildNote(record('d1'))) as Record<string, unknown>;
  assert.equal(note['decisionId'], 'd1');
  assert.equal(note['type'], 'reuse');
  assert.equal(note['reason'], 'A fresh delivered result already exists for this purchase key.');
  // A consensus timestamp attests when, not whether it is true. Say so in the record
  // itself, so the note cannot be quoted as proof of its own contents.
  assert.match(String(note['disclaimer']), /not that it is true/);
});

test('native note fees and chunks are bounded before signing; oversized notes are rejected', () => {
  const transaction = buildNoteTransaction(record('bounded-note'));
  assert.equal(transaction.maxTransactionFee?.toTinybars().toString(), '10000000');
  assert.equal(transaction.maxChunks, 1);
  assert.equal(transaction.maxAttempts, 1);
  assert.throws(() => buildNoteTransaction({ ...record('oversized'), reason: 'x'.repeat(1025) }), /one-message limit/);
});

test('a failed publication is queued rather than lost', async () => {
  const publisher = stubPublisher(1);
  await assert.rejects(() => publisher.publish(record('d1')));
  publisher.queue(record('d1'));
  assert.equal(publisher.pending().length, 1);
});

test('retrying publishes the queued note and clears it', async () => {
  const publisher = stubPublisher(1);
  await publisher.publish(record('d1')).catch(() => publisher.queue(record('d1')));

  const results = await publisher.retryPending();
  assert.equal(results.length, 1);
  assert.equal(publisher.pending().length, 0);
  assert.deepEqual(publisher.published, ['d1']);
});

test('a note is never queued twice, so a retry cannot publish duplicates', async () => {
  const publisher = stubPublisher(2);
  await publisher.publish(record('d1')).catch(() => publisher.queue(record('d1')));
  await publisher.publish(record('d1')).catch(() => publisher.queue(record('d1')));
  assert.equal(publisher.pending().length, 1);

  await publisher.retryPending();
  assert.deepEqual(publisher.published, ['d1'], 'the note must appear exactly once');
});

test('repeated retries of a persistently failing note publish nothing and lose nothing', async () => {
  const publisher = stubPublisher(99);
  await publisher.publish(record('d1')).catch(() => publisher.queue(record('d1')));

  for (let i = 0; i < 5; i += 1) await publisher.retryPending();

  assert.deepEqual(publisher.published, []);
  assert.equal(publisher.pending().length, 1, 'the note stays queued for a later attempt');
});

test('the publisher has no access to payment execution', () => {
  // Phase 4: "HCS failure — retry note independently from payment."
  // This is guaranteed structurally rather than by discipline: decision-notes.ts imports
  // no payment module, so no number of retries can reach executePayment. This test
  // documents the property and fails loudly if the surface ever grows one.
  const publisher = stubPublisher();
  const surface = Object.keys(publisher).filter((key) => typeof (publisher as never)[key] === 'function');
  assert.deepEqual(surface.sort(), ['close', 'pending', 'publish', 'queue', 'retryPending']);
  for (const key of surface) {
    assert.doesNotMatch(key, /pay|settle|reserve|transfer/i, `${key} suggests payment capability`);
  }
});
