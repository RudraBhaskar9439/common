/**
 * Decision notes on the Hedera Consensus Service.
 *
 * The contract event records WHAT was decided. This records WHY, as prose, with a
 * consensus timestamp and sequence number the network agrees on.
 *
 * **This module cannot spend money.** It imports no payment code and holds no path to
 * one. That is deliberate and structural: the Phase 4 requirement is that retrying an
 * HCS note never replays a payment, and the cheapest way to guarantee that is to make it
 * impossible rather than careful.
 *
 * **Honest limitation:** a consensus timestamp proves WHEN a note was written. It does
 * not prove the note is TRUE. An agent can record a reason that is mistaken or
 * self-serving. Receipts and observed delivery are the evidence; this is a claim with a
 * reliable clock attached.
 */
import { Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from '@hashgraph/sdk';
import type { DecisionRecord } from '@common/interfaces';

export interface PublishedNote {
  sequenceNumber: string;
  consensusTimestamp: string;
  topicId: string;
}

export interface DecisionNotePublisher {
  /** Publishes one note. Throws on failure; the caller decides whether to queue a retry. */
  publish(record: DecisionRecord): Promise<PublishedNote>;
  /** Notes that failed to publish and are awaiting retry. */
  pending(): DecisionRecord[];
  /** Queues a note for later retry. */
  queue(record: DecisionRecord): void;
  /**
   * Retries every queued note. Publishes only — it has no ability to move money.
   * Returns what succeeded; anything still failing stays queued.
   */
  retryPending(): Promise<PublishedNote[]>;
  close(): void;
}

/** The note as written to the topic. Keep this stable; it is a public record. */
export function buildNote(record: DecisionRecord): string {
  return JSON.stringify({
    schemaVersion: record.schemaVersion,
    decisionId: record.decisionId,
    workspaceId: record.workspaceId,
    agentId: record.agentId,
    type: record.type,
    chosen: record.chosen,
    rejected: record.rejected,
    reason: record.reason,
    createdAt: record.createdAt,
    operationId: record.operationId ?? null,
    result: record.result ?? null,
    disclaimer: 'Agent-stated reasoning. The consensus timestamp attests when this was written, not that it is true.',
  });
}

function clientFor(network: string, accountId: string, privateKey: string): Client {
  const client =
    network === 'mainnet' ? Client.forMainnet() : network === 'previewnet' ? Client.forPreviewnet() : Client.forTestnet();
  let key: PrivateKey;
  try {
    key = PrivateKey.fromStringECDSA(privateKey);
  } catch {
    key = PrivateKey.fromStringED25519(privateKey);
  }
  client.setOperator(accountId, key);
  return client;
}

export interface PublisherConfig {
  network: string;
  topicId: string;
  accountId: string;
  privateKey: string;
}

export function createDecisionNotePublisher(config: PublisherConfig): DecisionNotePublisher {
  const client = clientFor(config.network, config.accountId, config.privateKey);
  const topic = TopicId.fromString(config.topicId);
  const queued: DecisionRecord[] = [];

  async function publishOne(record: DecisionRecord): Promise<PublishedNote> {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(topic)
      .setMessage(buildNote(record))
      .execute(client);
    const receipt = await response.getReceipt(client);
    return {
      sequenceNumber: receipt.topicSequenceNumber?.toString() ?? '',
      consensusTimestamp: response.transactionId?.validStart?.toString() ?? '',
      topicId: config.topicId,
    };
  }

  return {
    publish: publishOne,

    pending() {
      return [...queued];
    },

    queue(record) {
      // Deduplicate by decision id so repeated failures do not publish twice on retry.
      if (!queued.some((row) => row.decisionId === record.decisionId)) queued.push(record);
    },

    async retryPending() {
      const published: PublishedNote[] = [];
      // Iterate over a copy; successful notes are removed from the live queue.
      for (const record of [...queued]) {
        try {
          published.push(await publishOne(record));
          const index = queued.findIndex((row) => row.decisionId === record.decisionId);
          if (index >= 0) queued.splice(index, 1);
        } catch {
          // Stays queued. No payment code is reachable from here.
        }
      }
      return published;
    },

    close() {
      client.close();
    },
  };
}

/**
 * Reads a published note back through the mirror node REST API. Used by the UI and by
 * live verification. Notes take a few seconds to appear after publication.
 */
export async function readNote(
  mirrorNodeUrl: string,
  topicId: string,
  sequenceNumber: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const url = `${mirrorNodeUrl.replace(/\/$/, '')}/api/v1/topics/${topicId}/messages/${sequenceNumber}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`mirror node returned ${response.status} for ${url}`);
  const body = (await response.json()) as { message?: string };
  if (!body.message) throw new Error('mirror node returned no message content');
  return JSON.parse(Buffer.from(body.message, 'base64').toString('utf8'));
}
