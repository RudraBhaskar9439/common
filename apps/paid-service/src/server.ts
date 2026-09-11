/**
 * x402-gated dataset API.
 *
 * Unpaid request  -> 402 with a PAYMENT-REQUIRED header stating price, asset, payTo,
 *                    validity window and the facilitator's feePayer.
 * Paid request    -> PAYMENT-SIGNATURE carrying a partially signed TransferTransaction,
 *                    which we /verify then /settle through the facilitator, returning
 *                    the dataset plus a PAYMENT-RESPONSE header.
 *
 * This service holds no keys and signs nothing. It states a price and checks payment.
 *
 * Ordering note: we settle BEFORE returning the payload. If settlement succeeds but the
 * response never reaches the client, the client holds a paid receipt and no data — which
 * is precisely why payment success and delivery success are separate states on the
 * paying side, and why delivery failure must never trigger an automatic repurchase.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig, loadEnvFileIfPresent, type PaidServiceConfig } from './config.js';
import { findDataset, DATASETS, type Dataset } from './providers/datasets.js';
import { assessDelivery } from '@common/graph-client';
import {
  decodePaymentPayload,
  encodeHeader,
  FacilitatorClient,
  FacilitatorError,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  MalformedPaymentError,
  receiptOf,
  X402_VERSION,
  type PaymentRequirements,
} from './payment/x402.js';

export function buildRequirements(config: PaidServiceConfig, dataset: Dataset, resource: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: config.network,
    amount: config.priceAmount,
    asset: config.priceAsset,
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    resource,
    description: dataset.description,
    mimeType: 'application/json',
    extra: { feePayer: config.feePayer },
  };
}

/**
 * The pinned block, taken from `?block=`.
 *
 * It must come from the request, not the server: the buyer and the seller have to agree
 * on which block is being sold, and `resource` — which carries the query string — is bound
 * into the contract's paramsHash. A server-chosen block would make two buyers of the same
 * purchase key receive different bytes, which is the property reuse depends on.
 */
function pinnedBlock(url: URL): number | null {
  const raw = url.searchParams.get('block');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const block = Number(raw);
  return Number.isSafeInteger(block) && block > 0 ? block : null;
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(payload);
}

export function createApp(
  config: PaidServiceConfig,
  facilitator = new FacilitatorClient(config.facilitatorUrl),
  /** Injected in tests so the dataset query does not reach a live provider. */
  deps: { fetchImpl?: typeof fetch } = {},
) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    if (path === '/health') {
      json(res, 200, {
        status: 'ok',
        network: config.network,
        payTo: config.payTo,
        facilitator: config.facilitatorUrl,
        datasets: Object.keys(DATASETS),
      });
      return;
    }

    // Diagnostic: what the facilitator actually supports. Run this before assuming
    // a scheme or network identifier is correct.
    if (path === '/facilitator/supported') {
      try {
        json(res, 200, await facilitator.supported());
      } catch (err) {
        json(res, 502, { error: 'facilitator_unreachable', detail: String(err) });
      }
      return;
    }

    const match = /^\/datasets\/([\w-]+)$/.exec(path);
    if (!match || req.method !== 'GET') {
      json(res, 404, { error: 'not_found' });
      return;
    }

    const dataset = findDataset(match[1] as string);
    if (!dataset) {
      json(res, 404, { error: 'unknown_dataset', datasets: Object.keys(DATASETS) });
      return;
    }

    // Refused before a price is quoted. Taking payment for a request that cannot be
    // fulfilled is the failure worth avoiding here.
    const block = pinnedBlock(url);
    if (block === null) {
      json(res, 400, {
        error: 'missing_pinned_block',
        detail: 'A ?block=<number> query parameter is required. Data is sold pinned to a block so two buyers of the same purchase key receive identical bytes.',
      });
      return;
    }

    // The block is part of the resource identity, so the reservation's paramsHash
    // binds which block was bought.
    const resource = `${url.origin}${path}${url.search}`;
    const requirements = buildRequirements(config, dataset, resource);
    const signature = req.headers[HEADER_PAYMENT_SIGNATURE];

    // --- unpaid: state the price -----------------------------------------
    if (typeof signature !== 'string' || signature.length === 0) {
      json(
        res,
        402,
        { x402Version: X402_VERSION, error: 'payment_required', accepts: [requirements] },
        { [HEADER_PAYMENT_REQUIRED]: encodeHeader({ x402Version: X402_VERSION, accepts: [requirements] }) },
      );
      return;
    }

    // --- paid: verify, settle, then deliver -------------------------------
    try {
      const payload = decodePaymentPayload(signature);

      const verification = await facilitator.verify(payload, requirements);
      if (!verification.isValid) {
        json(res, 402, {
          x402Version: X402_VERSION,
          error: 'payment_invalid',
          reason: verification.invalidReason ?? 'facilitator rejected the payment payload',
          accepts: [requirements],
        });
        return;
      }

      // Any failure from here on is UNKNOWN, not failed. Once /settle has been called
      // the facilitator may already have submitted the transfer, and a network error,
      // timeout or malformed reply tells us nothing about whether it did. The caller
      // must reconcile against the mirror node; it must never simply retry.
      let settlement;
      try {
        settlement = await facilitator.settle(payload, requirements);
      } catch (err) {
        json(res, 502, {
          error: 'settlement_unknown',
          detail: err instanceof Error ? err.message : String(err),
          settlementCertainty: 'unknown',
        });
        return;
      }

      // Facilitators vary in how they name the receipt field. Log the raw shape so a
      // missing transaction id can be diagnosed without another paid request.
      console.log('[settle] facilitator response:', JSON.stringify(settlement));

      if (!settlement.success) {
        json(res, 402, {
          x402Version: X402_VERSION,
          error: 'settlement_failed',
          reason: settlement.errorReason ?? 'facilitator could not settle the payment',
          accepts: [requirements],
        });
        return;
      }

      const content = await dataset.build(block, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : undefined);
      // Assessed here so the buyer is told what it is actually receiving.
      const delivery = assessDelivery(content);

      json(
        res,
        200,
        {
          dataset: dataset.id,
          // Derived from the bytes being delivered, not declared by us. A seller's own
          // capability list can be wrong, and two of ours were.
          capabilities: delivery.capabilities,
          advertisedCapabilities: dataset.capabilities,
          capabilityEvidence: delivery.evidence,
          usable: delivery.usable,
          failureReason: delivery.failureReason ?? null,
          rowCount: delivery.rowCount,
          freshUntil: new Date(Date.now() + dataset.freshnessSeconds * 1000).toISOString(),
          payment: {
            transactionId: receiptOf(settlement) || null,
            network: settlement.network ?? config.network,
            payer: settlement.payer ?? null,
            /** Raw facilitator response, so a receipt is never lost to a field-name mismatch. */
            raw: settlement,
          },
          content,
        },
        { [HEADER_PAYMENT_RESPONSE]: encodeHeader(settlement) },
      );
    } catch (err) {
      if (err instanceof MalformedPaymentError) {
        json(res, 400, { error: 'malformed_payment', detail: err.message });
        return;
      }
      // Settlement failures are handled above. Anything reaching here failed at or
      // before /verify, so no transfer was submitted and the caller is safe to retry.
      if (err instanceof FacilitatorError) {
        json(res, 502, { error: 'facilitator_unavailable', detail: err.message, settlementCertainty: 'none' });
        return;
      }
      json(res, 502, {
        error: 'verification_failed',
        detail: err instanceof Error ? err.message : String(err),
        settlementCertainty: 'none',
      });
    }
  };
}

export function startServer(config = (loadEnvFileIfPresent(), loadConfig())) {
  const server = createServer((req, res) => {
    void createApp(config)(req, res);
  });
  server.listen(config.port, () => {
    console.log(`paid-service listening on http://localhost:${config.port}`);
    console.log(`  network:     ${config.network}`);
    console.log(`  payTo:       ${config.payTo}`);
    console.log(`  price:       ${config.priceAmount} of ${config.priceAsset}`);
    console.log(`  facilitator: ${config.facilitatorUrl}`);
    console.log(`  datasets:    ${Object.keys(DATASETS).join(', ')}`);
  });
  return server;
}

const isEntry = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isEntry) startServer();
