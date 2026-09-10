/**
 * Service configuration. Values come from the environment only; this service holds
 * no keys and signs nothing. It states a price and verifies payment through a
 * facilitator.
 */
export interface PaidServiceConfig {
  port: number;
  /** Blocky402 facilitator base URL, e.g. https://api.testnet.blocky402.com */
  facilitatorUrl: string;
  /** CAIP-2 style network identifier used in PaymentRequirements. */
  network: string;
  /** Hedera account id (0.0.x) that receives payment. */
  payTo: string;
  /** Price in the asset's smallest unit. HBAR is tinybars (1 HBAR = 1e8). */
  priceAmount: string;
  /** "0.0.0" for HBAR, or an HTS fungible token entity id. */
  priceAsset: string;
  /** Validity window for the signed transfer. */
  maxTimeoutSeconds: number;
  /**
   * Facilitator account that pays gas and submits. The Hedera `exact` scheme requires
   * transactionId.accountId to equal this. Discover it from the facilitator's
   * /supported endpoint rather than guessing.
   */
  feePayer: string;
}

class ConfigError extends Error {}

/**
 * Loads a .env file if present, using Node's built-in loader so no dependency and no
 * runner flag is involved. Existing shell variables win. Silent when absent.
 */
export function loadEnvFileIfPresent(file = '.env'): void {
  try {
    process.loadEnvFile(file);
  } catch {
    /* absent or unreadable: fall back to the ambient environment */
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigError(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(): PaidServiceConfig {
  const network = process.env['HEDERA_NETWORK'] ?? 'testnet';
  return {
    port: Number(process.env['PORT'] ?? 3002),
    facilitatorUrl: (process.env['BLOCKY402_FACILITATOR_URL'] ?? 'https://api.testnet.blocky402.com').replace(
      /\/$/,
      '',
    ),
    network: `hedera:${network}`,
    payTo: required('PAY_TO_ACCOUNT_ID'),
    priceAmount: process.env['PRICE_AMOUNT'] ?? '50000000',
    priceAsset: process.env['PRICE_ASSET_ID'] ?? '0.0.0',
    maxTimeoutSeconds: Number(process.env['MAX_TIMEOUT_SECONDS'] ?? 180),
    feePayer: required('FACILITATOR_FEE_PAYER_ACCOUNT_ID'),
  };
}
