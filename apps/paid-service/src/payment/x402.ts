/**
 * x402 v2 wire types and header encoding, plus the Blocky402 facilitator client.
 *
 * Verified against the x402 v2 specification and the Hedera `exact` scheme spec:
 * the client signs a frozen, partially signed TransferTransaction whose
 * transactionId.accountId equals the facilitator's feePayer. The facilitator adds the
 * final signature, pays gas and submits. No contract call is permitted in this path.
 */

export const X402_VERSION = 2;

export const HEADER_PAYMENT_REQUIRED = 'payment-required';
export const HEADER_PAYMENT_SIGNATURE = 'payment-signature';
export const HEADER_PAYMENT_RESPONSE = 'payment-response';

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
  mimeType: string;
  extra: { feePayer: string };
}

export interface PaymentRequiredBody {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirements[];
}

/**
 * x402 v2 shape: `accepted` carries the full PaymentRequirements the client is paying
 * against, and the facilitator verifies the signed transfer against it. The v1 shape
 * (scheme/network at the top level, no `accepted`) is rejected.
 */
export interface PaymentPayload {
  x402Version: number;
  resource?: { url: string; description: string; mimeType: string };
  accepted: PaymentRequirements;
  /** Hedera `exact`: { transaction: base64 partially signed TransferTransaction } */
  payload: { transaction: string };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  transactionId?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function decodeHeader<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T;
}

/** Thrown when a client sends a PAYMENT-SIGNATURE we cannot parse. */
export class MalformedPaymentError extends Error {}

export function decodePaymentPayload(header: string): PaymentPayload {
  let decoded: PaymentPayload;
  try {
    decoded = decodeHeader<PaymentPayload>(header);
  } catch {
    throw new MalformedPaymentError('PAYMENT-SIGNATURE is not valid base64-encoded JSON');
  }
  if (typeof decoded?.payload?.transaction !== 'string') {
    throw new MalformedPaymentError('PAYMENT-SIGNATURE is missing payload.transaction');
  }
  return decoded;
}

export class FacilitatorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Blocky402 facilitator client. The facilitator cannot alter payTo or amount — the
 * spec requires it to reject any deviation — but it can stall, drop or submit late,
 * which is what produces an unknown settlement on the paying side.
 */
export class FacilitatorClient {
  constructor(private readonly baseUrl: string) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new FacilitatorError(`${path} failed: ${response.status} ${text.slice(0, 300)}`, response.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new FacilitatorError(`${path} returned non-JSON: ${text.slice(0, 300)}`, response.status);
    }
  }

  /** Lists schemes and networks the facilitator actually supports. */
  async supported(): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/supported`);
    const text = await response.text();
    if (!response.ok) throw new FacilitatorError(`/supported failed: ${response.status}`, response.status);
    return JSON.parse(text) as unknown;
  }

  verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.post<VerifyResponse>('/verify', {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    });
  }

  settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResponse> {
    return this.post<SettleResponse>('/settle', {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    });
  }
}
