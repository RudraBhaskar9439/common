/**
 * Drives one x402 paid request:
 *   GET resource -> 402 + PAYMENT-REQUIRED -> build & sign transfer
 *   -> GET resource with PAYMENT-SIGNATURE -> 200 + PAYMENT-RESPONSE
 *
 * Settlement certainty is the whole point of this module. Three outcomes, and they are
 * NOT interchangeable:
 *   paid                -> we hold a real transaction id
 *   failed              -> nothing was submitted; safe to retry with the same operation id
 *   settlement_unknown  -> the transfer may or may not exist; reconcile against the
 *                          mirror node. NEVER retry, never release the reservation.
 *
 * Anything ambiguous resolves to settlement_unknown. A false "failed" causes a double
 * payment, which is the exact failure this project exists to prevent.
 */
import { buildSignedTransfer, signedTransferIdentity, type TransferIdentity } from './transfer.js';

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource?: string;
  description?: string;
  mimeType?: string;
  extra?: { feePayer?: string };
}

export interface PaymentRequiredBody {
  x402Version: number;
  accepts: PaymentRequirements[];
}

export type PaidRequestOutcome =
  | { status: 'paid'; transactionId: string; payer: string | null; content: unknown; requirements: PaymentRequirements }
  | { status: 'failed'; reason: string; requirements?: PaymentRequirements }
  | { status: 'settlement_unknown'; reason: string; requirements: PaymentRequirements };

export interface PaidRequestInput {
  resourceUrl: string;
  network: 'testnet' | 'mainnet' | 'previewnet';
  fromAccountId: string;
  privateKey: string;
  /** Hard ceiling. A quote above this is refused before anything is signed. */
  maxAmount: bigint;
  expectedAmount?: bigint;
  /** Must durably record identity and claim submission before any paid request is sent. */
  beforeSubmit?: (identity: TransferIdentity) => Promise<void>;
  /** Optional: refuse to pay a recipient other than the one bound to the reservation. */
  expectedPayTo?: string;
  expectedAsset?: string;
  fetchImpl?: typeof fetch;
}

const HEADER_PAYMENT_REQUIRED = 'payment-required';
const HEADER_PAYMENT_SIGNATURE = 'payment-signature';

function decode<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T;
}

export async function executePaidRequest(input: PaidRequestInput): Promise<PaidRequestOutcome> {
  const doFetch = input.fetchImpl ?? fetch;

  // --- 1. unpaid probe ---------------------------------------------------
  let quote: Response;
  try {
    quote = await doFetch(input.resourceUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch (err) {
    return { status: 'failed', reason: `Could not reach the resource: ${String(err)}` };
  }

  if (quote.status !== 402) {
    if (quote.ok) {
      return { status: 'failed', reason: `Resource returned ${quote.status} without requesting payment` };
    }
    return { status: 'failed', reason: `Unexpected status ${quote.status} from the resource` };
  }

  // --- 2. read the requirements ------------------------------------------
  const header = quote.headers.get(HEADER_PAYMENT_REQUIRED);
  let requirements: PaymentRequirements | undefined;
  try {
    if (header) {
      requirements = decode<PaymentRequiredBody>(header).accepts[0];
    } else {
      requirements = ((await quote.json()) as PaymentRequiredBody).accepts?.[0];
    }
  } catch (err) {
    return { status: 'failed', reason: `Could not parse payment requirements: ${String(err)}` };
  }
  if (!requirements) return { status: 'failed', reason: 'Resource sent 402 with no payment requirements' };

  const feePayer = requirements.extra?.feePayer;
  if (!feePayer) {
    return { status: 'failed', reason: 'Requirements omit extra.feePayer, which the Hedera exact scheme requires' };
  }

  // --- 3. refuse anything that does not match what we agreed to pay -------
  if (requirements.scheme !== 'exact' || requirements.network !== `hedera:${input.network}`
    || (requirements.resource !== undefined && requirements.resource !== input.resourceUrl)
    || !/^\d+$/.test(requirements.amount)
    || !Number.isInteger(requirements.maxTimeoutSeconds)
    || requirements.maxTimeoutSeconds < 30 || requirements.maxTimeoutSeconds > 180) {
    return { status: 'failed', reason: 'Invalid or mismatched payment terms', requirements };
  }
  const amount = BigInt(requirements.amount);
  if (amount <= 0n || (input.expectedAmount !== undefined && amount !== input.expectedAmount)) {
    return { status: 'failed', reason: 'Quote does not match the reserved amount', requirements };
  }
  if (amount > input.maxAmount) {
    return { status: 'failed', reason: `Quote ${amount} exceeds the configured ceiling ${input.maxAmount}`, requirements };
  }
  if (input.expectedPayTo && requirements.payTo !== input.expectedPayTo) {
    return {
      status: 'failed',
      reason: `Recipient ${requirements.payTo} does not match the reserved recipient ${input.expectedPayTo}`,
      requirements,
    };
  }
  if (input.expectedAsset && requirements.asset !== input.expectedAsset) {
    return {
      status: 'failed',
      reason: `Asset ${requirements.asset} does not match the reserved asset ${input.expectedAsset}`,
      requirements,
    };
  }

  // --- 4. build and sign (nothing has been submitted yet) -----------------
  let signedTransaction: string;
  try {
    signedTransaction = await buildSignedTransfer({
      network: input.network,
      fromAccountId: input.fromAccountId,
      privateKey: input.privateKey,
      payTo: requirements.payTo,
      amount,
      asset: requirements.asset,
      feePayer,
      validSeconds: requirements.maxTimeoutSeconds,
    });
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : 'Could not sign the transfer', requirements };
  }

  // x402 v2 PaymentPayload: { x402Version, resource?, accepted, payload }.
  // `accepted` carries the full PaymentRequirements we are paying against — the
  // facilitator verifies the signed transfer against it. Omitting it (the v1 shape)
  // makes the facilitator fail with a 500.
  const paymentHeader = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: {
        url: requirements.resource ?? input.resourceUrl,
        description: requirements.description ?? '',
        mimeType: requirements.mimeType ?? 'application/json',
      },
      accepted: requirements,
      payload: { transaction: signedTransaction },
    }),
    'utf8',
  ).toString('base64');

  let identity: TransferIdentity;
  try {
    identity = signedTransferIdentity(signedTransaction);
    await input.beforeSubmit?.(identity);
  } catch {
    return { status: 'failed', reason: 'Submission preparation failed; no paid request sent', requirements };
  }

  // --- 5. submit. from here, uncertainty means UNKNOWN, never failed ------
  let paid: Response;
  try {
    paid = await doFetch(input.resourceUrl, {
      redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { [HEADER_PAYMENT_SIGNATURE]: paymentHeader },
    });
  } catch (err) {
    // The request may have reached the server, which may have settled it.
    return {
      status: 'settlement_unknown',
      reason: `Network failure after submitting payment: ${String(err)}`,
      requirements,
    };
  }

  let body: Record<string, unknown>;
  try {
    body = (await paid.json()) as Record<string, unknown>;
  } catch {
    return {
      status: 'settlement_unknown',
      reason: `Unreadable response (status ${paid.status}) after submitting payment`,
      requirements,
    };
  }

  if (paid.ok) {
    const payment = (body['payment'] ?? {}) as Record<string, unknown>;
    const raw = (payment['raw'] ?? {}) as Record<string, unknown>;
    // Facilitators differ on the receipt field name. Accept the known aliases before
    // declaring the settlement unevidenced.
    const transactionId = [
      payment['transactionId'],
      raw['transactionId'],
      raw['transaction'],
      raw['txId'],
      raw['hash'],
    ].find((value): value is string => typeof value === 'string' && value.length > 0);

    if (!transactionId) {
      // Delivered content without a receipt: we cannot prove what we paid for.
      return {
        status: 'settlement_unknown',
        reason: `Resource delivered content without a transaction id. Facilitator response: ${JSON.stringify(raw)}`,
        requirements,
      };
    }
    const normalize = (value: string) => value.replace(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/, '$1-$2-$3');
    if (normalize(transactionId) !== normalize(identity.transactionId)) {
      return { status: 'settlement_unknown', reason: 'Receipt does not identify the submitted transaction', requirements };
    }
    return {
      status: 'paid',
      transactionId,
      payer: typeof payment['payer'] === 'string' ? payment['payer'] : null,
      content: body['content'],
      requirements,
    };
  }

  // The service distinguishes these for us. Trust its certainty signal when present.
  const certainty = body['settlementCertainty'];
  if (certainty === 'unknown') {
    return { status: 'settlement_unknown', reason: String(body['detail'] ?? body['error'] ?? 'unknown'), requirements };
  }
  // Signed bytes have left this process. An HTTP error is not independent proof of
  // non-submission. Reconcile this exact transaction; never sign a replacement here.

  // No certainty signal and a non-402 error: assume the worst, which is uncertainty.
  return {
    status: 'settlement_unknown',
    reason: `Unclear response (status ${paid.status}) with no settlement certainty signal`,
    requirements,
  };
}
