/**
 * Exercises the x402 gate against a LABELED FAKE facilitator. These tests prove the
 * gate's logic and header handling. They prove nothing about Hedera, Blocky402 or real
 * settlement — that requires a live paid request.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, buildRequirements } from '../src/server.js';
import type { PaidServiceConfig } from '../src/config.js';
import {
  encodeHeader,
  decodeHeader,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  type PaymentRequiredBody,
  type SettleResponse,
  type VerifyResponse,
  type PaymentPayload,
  type PaymentRequirements,
} from '../src/payment/x402.js';
import { DATASETS } from '../src/providers/datasets.js';

const config: PaidServiceConfig = {
  port: 0,
  facilitatorUrl: 'http://fake.invalid',
  network: 'hedera:testnet',
  payTo: '0.0.1111',
  priceAmount: '50000000',
  priceAsset: '0.0.0',
  maxTimeoutSeconds: 180,
  feePayer: '0.0.2222',
};

/** LABELED FAKE — no network, no chain, no facilitator. */
function fakeFacilitator(overrides: {
  verify?: Partial<VerifyResponse>;
  settle?: Partial<SettleResponse>;
  throwOn?: 'verify' | 'settle';
}) {
  return {
    async supported() {
      return { kinds: [] };
    },
    async verify(): Promise<VerifyResponse> {
      if (overrides.throwOn === 'verify') throw new Error('boom');
      return { isValid: true, ...overrides.verify };
    },
    async settle(): Promise<SettleResponse> {
      if (overrides.throwOn === 'settle') throw new Error('boom');
      return { success: true, transactionId: '0.0.2222@1757505600.000000001', ...overrides.settle };
    },
  };
}

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

async function call(
  handler: ReturnType<typeof createApp>,
  path: string,
  headers: Record<string, string> = {},
): Promise<Captured> {
  const captured: Captured = { status: 0, headers: {}, body: undefined };
  const req = { url: path, method: 'GET', headers: { host: 'localhost:3002', ...headers } };
  const res = {
    writeHead(status: number, h: Record<string, string>) {
      captured.status = status;
      captured.headers = h;
    },
    end(body: string) {
      captured.body = JSON.parse(body) as unknown;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler(req as any, res as any);
  return captured;
}

const signedHeader = () =>
  encodeHeader({
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'hedera:testnet',
      amount: '50000000',
      asset: '0.0.0',
      payTo: '0.0.1111',
      maxTimeoutSeconds: 180,
      resource: 'http://localhost:3002/datasets/daily-transfers',
      description: 'test',
      mimeType: 'application/json',
      extra: { feePayer: '0.0.2222' },
    },
    payload: { transaction: 'BASE64_PARTIALLY_SIGNED_TRANSFER' },
  } satisfies PaymentPayload);

test('an unpaid request is refused with 402 and full payment requirements', async () => {
  const app = createApp(config, fakeFacilitator({}) as never);
  const res = await call(app, '/datasets/daily-transfers');

  assert.equal(res.status, 402);
  const header = res.headers[HEADER_PAYMENT_REQUIRED];
  assert.ok(header, 'PAYMENT-REQUIRED header must be present');

  const decoded = decodeHeader<PaymentRequiredBody>(header);
  const req = decoded.accepts[0] as PaymentRequirements;
  assert.equal(decoded.x402Version, 2);
  assert.equal(req.scheme, 'exact');
  assert.equal(req.network, 'hedera:testnet');
  assert.equal(req.amount, '50000000');
  assert.equal(req.asset, '0.0.0');
  assert.equal(req.payTo, '0.0.1111');
  assert.equal(req.extra.feePayer, '0.0.2222');
  assert.equal(req.maxTimeoutSeconds, 180);
});

test('an unpaid request returns no dataset content', async () => {
  const app = createApp(config, fakeFacilitator({}) as never);
  const res = await call(app, '/datasets/daily-transfers');
  assert.equal((res.body as Record<string, unknown>)['content'], undefined);
});

test('a verified and settled request returns the dataset and a settlement header', async () => {
  const app = createApp(config, fakeFacilitator({}) as never);
  const res = await call(app, '/datasets/daily-transfers', { [HEADER_PAYMENT_SIGNATURE]: signedHeader() });

  assert.equal(res.status, 200);
  const body = res.body as Record<string, any>;
  assert.equal(body['dataset'], 'daily-transfers');
  assert.ok(body['content'], 'content must be delivered after settlement');
  assert.equal(body['payment'].transactionId, '0.0.2222@1757505600.000000001');
  assert.deepEqual(body['capabilities'], DATASETS['daily-transfers']?.capabilities);

  const settle = decodeHeader<SettleResponse>(res.headers[HEADER_PAYMENT_RESPONSE] as string);
  assert.equal(settle.success, true);
});

test('a payload the facilitator rejects does not deliver content', async () => {
  const app = createApp(config, fakeFacilitator({ verify: { isValid: false, invalidReason: 'bad signature' } }) as never);
  const res = await call(app, '/datasets/daily-transfers', { [HEADER_PAYMENT_SIGNATURE]: signedHeader() });

  assert.equal(res.status, 402);
  const body = res.body as Record<string, unknown>;
  assert.equal(body['error'], 'payment_invalid');
  assert.equal(body['content'], undefined);
});

test('a failed settlement does not deliver content', async () => {
  const app = createApp(
    config,
    fakeFacilitator({ settle: { success: false, errorReason: 'insufficient balance' } }) as never,
  );
  const res = await call(app, '/datasets/daily-transfers', { [HEADER_PAYMENT_SIGNATURE]: signedHeader() });

  assert.equal(res.status, 402);
  assert.equal((res.body as Record<string, unknown>)['error'], 'settlement_failed');
  assert.equal((res.body as Record<string, unknown>)['content'], undefined);
});

test('a facilitator outage reports unknown settlement rather than failure', async () => {
  const app = createApp(config, fakeFacilitator({ throwOn: 'settle' }) as never);
  const res = await call(app, '/datasets/daily-transfers', { [HEADER_PAYMENT_SIGNATURE]: signedHeader() });

  assert.equal(res.status, 502);
  const body = res.body as Record<string, unknown>;
  // The transfer may already have been submitted. The caller must reconcile, not retry.
  assert.equal(body['settlementCertainty'], 'unknown');
});

test('a plain network failure during settlement is still reported as unknown', async () => {
  // A real outage throws a TypeError from fetch, not a FacilitatorError. It must not
  // fall through to a generic error: the transfer may already have been submitted.
  const app = createApp(config, fakeFacilitator({ throwOn: 'settle' }) as never);
  const res = await call(app, '/datasets/daily-transfers', { [HEADER_PAYMENT_SIGNATURE]: signedHeader() });

  assert.equal((res.body as Record<string, unknown>)['error'], 'settlement_unknown');
  assert.equal((res.body as Record<string, unknown>)['content'], undefined);
});

test('a failure before settlement is safe to retry, not unknown', async () => {
  // Nothing was submitted, so the caller must not be pushed into reconciliation.
  const app = createApp(config, fakeFacilitator({ throwOn: 'verify' }) as never);
  const res = await call(app, '/datasets/daily-transfers', { [HEADER_PAYMENT_SIGNATURE]: signedHeader() });

  assert.equal(res.status, 502);
  assert.equal((res.body as Record<string, unknown>)['settlementCertainty'], 'none');
});

test('a malformed payment header is rejected without contacting the facilitator', async () => {
  const app = createApp(config, fakeFacilitator({ throwOn: 'verify' }) as never);
  const res = await call(app, '/datasets/daily-transfers', { [HEADER_PAYMENT_SIGNATURE]: 'not-base64-json' });

  assert.equal(res.status, 400);
  assert.equal((res.body as Record<string, unknown>)['error'], 'malformed_payment');
});

test('an unknown dataset is refused before any payment is requested', async () => {
  const app = createApp(config, fakeFacilitator({}) as never);
  const res = await call(app, '/datasets/does-not-exist');
  assert.equal(res.status, 404);
});

test('the same dataset is byte-identical across calls, so two agents get the same result', () => {
  const first = JSON.stringify(DATASETS['daily-transfers']?.build());
  const second = JSON.stringify(DATASETS['daily-transfers']?.build());
  assert.equal(first, second);
});

test('requirements bind the resource url that was actually requested', () => {
  const dataset = DATASETS['daily-transfers'];
  assert.ok(dataset);
  const requirements = buildRequirements(config, dataset, 'http://localhost:3002/datasets/daily-transfers');
  assert.equal(requirements.resource, 'http://localhost:3002/datasets/daily-transfers');
});
