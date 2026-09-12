/**
 * Creates the HCS topic that holds decision notes.
 *
 * One live transaction, costing a fraction of a testnet HBAR. Run once; put the printed
 * topic id into HCS_TOPIC_ID. Creating a second topic orphans the notes in the first, so
 * the script refuses to run if HCS_TOPIC_ID is already set.
 *
 *   npm run create:topic
 *
 * The topic is created WITHOUT a submit key, so anyone may post to it. That is the right
 * choice here: the notes are a public audit trail, and a submit key would imply the
 * contents are authoritative. They are not — a note is an agent's claim, and the
 * contract event plus the payment receipt are the actual evidence.
 */
import { Client, PrivateKey, TopicCreateTransaction } from '@hashgraph/sdk';
import { loadAdapterConfig, loadEnvFileIfPresent } from '../config.js';
import { fileURLToPath } from 'node:url';

loadEnvFileIfPresent();
loadEnvFileIfPresent(fileURLToPath(new URL('../../../../.env', import.meta.url)));

async function main(): Promise<void> {
  if (process.env['HEDERA_NETWORK'] !== 'testnet' || process.env['CONFIRM_TESTNET_PAYMENT'] !== 'yes') throw new Error('Topic creation requires explicit testnet transaction authorization');
  const existing = process.env['HCS_TOPIC_ID'];
  if (existing) {
    console.log(`HCS_TOPIC_ID is already set to ${existing}.`);
    console.log('Creating another topic would orphan the notes already published to it.');
    console.log('Clear HCS_TOPIC_ID first if you genuinely want a new topic.');
    return;
  }

  const config = loadAdapterConfig();
  const client =
    config.network === 'mainnet'
      ? Client.forMainnet()
      : config.network === 'previewnet'
        ? Client.forPreviewnet()
        : Client.forTestnet();

  let key: PrivateKey;
  try {
    key = PrivateKey.fromStringECDSA(config.treasuryPrivateKey);
  } catch {
    key = PrivateKey.fromStringED25519(config.treasuryPrivateKey);
  }
  client.setOperator(config.treasuryAccountId, key);

  console.log(`creating a decision-note topic on ${config.network} as ${config.treasuryAccountId}...`);

  try {
    const response = await new TopicCreateTransaction()
      .setTopicMemo('Common — agent decision notes (buy/reuse/wait/reject)')
      .execute(client);
    const receipt = await response.getReceipt(client);
    const topicId = receipt.topicId?.toString();
    if (!topicId) throw new Error('topic creation returned no topic id');

    console.log(`\ntopic created: ${topicId}`);
    console.log(`explorer:      https://hashscan.io/${config.network}/topic/${topicId}`);
    console.log(`\nAdd this to packages/hedera-adapter/.env:`);
    console.log(`  HCS_TOPIC_ID=${topicId}`);
  } finally {
    client.close();
  }
}

main().catch(() => {
  console.error('Could not create the topic. Check testnet authorization and local configuration.');
  process.exitCode = 1;
});
