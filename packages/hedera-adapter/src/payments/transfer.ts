/**
 * Builds the partially signed TransferTransaction required by the x402 Hedera `exact`
 * scheme.
 *
 * Spec constraints enforced here:
 *  - must be a TransferTransaction directly, never wrapped in a ScheduleCreateTransaction
 *  - transactionId.accountId MUST equal PaymentRequirements.extra.feePayer, so the
 *    facilitator is the network-level fee payer, pays gas and adds the final signature
 *  - only the transfers needed for the payment, no other operations
 *  - net HBAR sum and net asset sum must each be zero
 *  - the fee payer must not appear as a negative entry in any transfer list
 *
 * We sign with the treasury key and deliberately leave the fee payer's signature absent.
 * That is what "partially signed" means, and it is why the facilitator can submit but
 * cannot redirect: payTo and amount are covered by our signature, and the spec requires
 * the facilitator to reject any deviation.
 */
import {
  AccountId,
  Client,
  Hbar,
  Long,
  PrivateKey,
  TokenId,
  TransactionId,
  Transaction,
  TransferTransaction,
} from '@hashgraph/sdk';

function clientFor(network: BuildTransferInput['network']): Client {
  if (network === 'mainnet') return Client.forMainnet();
  if (network === 'previewnet') return Client.forPreviewnet();
  return Client.forTestnet();
}

/** The SDK's amount parameters take Long, not bigint. */
const toLong = (value: bigint): Long => Long.fromString(value.toString());

/**
 * Accepts either key type. Portal accounts with an EVM address are ECDSA, but an
 * ED25519 treasury is equally valid for native transfers — only the EVM JSON-RPC
 * relay requires ECDSA. Never include the key material in the thrown message.
 */
function parseKey(value: string): PrivateKey {
  try {
    return PrivateKey.fromStringECDSA(value);
  } catch {
    try {
      return PrivateKey.fromStringED25519(value);
    } catch {
      throw new TransferBuildError('HEDERA_PRIVATE_KEY is not a valid ECDSA or ED25519 key');
    }
  }
}

export const HBAR_ASSET = '0.0.0';

export interface BuildTransferInput {
  network: 'testnet' | 'mainnet' | 'previewnet';
  /** Paying account (our treasury). */
  fromAccountId: string;
  /** Treasury private key. Never logged. */
  privateKey: string;
  /** Recipient from PaymentRequirements.payTo. */
  payTo: string;
  /** Amount in the asset's smallest unit: tinybars for HBAR. */
  amount: bigint;
  /** "0.0.0" for HBAR, otherwise an HTS fungible token id. */
  asset: string;
  /** PaymentRequirements.extra.feePayer — the facilitator's account. */
  feePayer: string;
  /** PaymentRequirements.maxTimeoutSeconds. */
  validSeconds: number;
  /** Consensus node the transaction targets. Defaults to 0.0.3. */
  nodeAccountId?: string;
}

export class TransferBuildError extends Error {}

export interface TransferIdentity {
  transactionId: string;
  validUntilEpochSeconds: number;
}

/** Identity from the exact signed bytes, for durable recovery before submission. */
export function signedTransferIdentity(bytes: string): TransferIdentity {
  const transaction = Transaction.fromBytes(Buffer.from(bytes, 'base64'));
  const id = transaction.transactionId;
  if (!id?.validStart) throw new TransferBuildError('Signed transfer has no transaction identity');
  return {
    transactionId: id.toString(),
    validUntilEpochSeconds: Number(id.validStart.seconds.toString()) + Number(transaction.transactionValidDuration.toString()),
  };
}

/**
 * @returns base64-encoded transaction bytes for the PAYMENT-SIGNATURE header.
 */
export async function buildSignedTransfer(input: BuildTransferInput): Promise<string> {
  if (input.amount <= 0n) throw new TransferBuildError('Payment amount must be positive');
  if (input.fromAccountId === input.payTo) {
    throw new TransferBuildError('Refusing to build a self-transfer');
  }
  if (input.feePayer === input.fromAccountId) {
    // Would make us the network-level fee payer, violating the scheme and paying gas.
    throw new TransferBuildError('Fee payer must be the facilitator, not the paying account');
  }
  if (input.feePayer === input.payTo) {
    throw new TransferBuildError('Fee payer must not be the payment recipient');
  }

  const from = AccountId.fromString(input.fromAccountId);
  const to = AccountId.fromString(input.payTo);
  // transactionId.accountId == feePayer is the scheme's core requirement.
  const transactionId = TransactionId.generate(AccountId.fromString(input.feePayer));

  // Matches the @x402/hedera reference signer: no setNodeAccountIds, freezeWith(client).
  const transaction = new TransferTransaction()
    .setTransactionId(transactionId)
    .setTransactionValidDuration(Math.min(Math.max(input.validSeconds, 30), 180));

  if (input.asset === HBAR_ASSET) {
    // Net HBAR sum is zero: one negative entry, one positive entry of equal size.
    transaction
      .addHbarTransfer(from, Hbar.fromTinybars(toLong(-input.amount)))
      .addHbarTransfer(to, Hbar.fromTinybars(toLong(input.amount)));
  } else {
    const token = TokenId.fromString(input.asset);
    // Both accounts must already be associated with the token, or settlement fails.
    transaction
      .addTokenTransfer(token, from, toLong(-input.amount))
      .addTokenTransfer(token, to, toLong(input.amount));
  }

  const client = clientFor(input.network);
  try {
    const frozen = transaction.freezeWith(client);
    // Partial signature: ours only. The facilitator adds the fee payer's.
    const signed = await frozen.sign(parseKey(input.privateKey));
    return Buffer.from(signed.toBytes()).toString('base64');
  } catch (err) {
    // Never surface the key material in an error path.
    throw new TransferBuildError(
      `Could not build the transfer: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  } finally {
    client.close();
  }
}
