/**
 * Configuration for the paying side.
 *
 * The treasury key is read from the environment and never logged, serialized, echoed
 * in an error, or written to a fixture. It must not be exposed to an AI agent.
 */
export interface HederaAdapterConfig {
  network: 'testnet' | 'mainnet' | 'previewnet';
  /** CAIP-2 network identifier used in x402 PaymentRequirements. */
  networkId: string;
  /** Hedera account id (0.0.x) that funds payments. Holds a working float, not the budget. */
  treasuryAccountId: string;
  /** ECDSA or ED25519 private key for the treasury account. Never log this. */
  treasuryPrivateKey: string;
  /** Mirror node REST base, used for settlement reconciliation. */
  mirrorNodeUrl: string;
  /** Hard ceiling per operation, in the asset's smallest unit. Enforced before signing. */
  maxPaymentAmount: bigint;
  /** Deployed CommonBudget address. */
  contractAddress: string;
  /** Hedera EVM JSON-RPC relay, used for contract calls. */
  jsonRpcUrl: string;
  /**
   * EVM key for the workspace operator. The contract's onlyOperator functions require
   * it. Usually the same portal ECDSA key as the treasury. Never logged.
   */
  operatorPrivateKey: string;
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

const JSON_RPC: Record<string, string> = {
  testnet: 'https://testnet.hashio.io/api',
  mainnet: 'https://mainnet.hashio.io/api',
  previewnet: 'https://previewnet.hashio.io/api',
};

const MIRROR_NODES: Record<string, string> = {
  testnet: 'https://testnet.mirrornode.hedera.com',
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  previewnet: 'https://previewnet.mirrornode.hedera.com',
};

export function loadAdapterConfig(): HederaAdapterConfig {
  const network = (process.env['HEDERA_NETWORK'] ?? 'testnet') as HederaAdapterConfig['network'];
  if (!MIRROR_NODES[network]) throw new ConfigError(`Unsupported HEDERA_NETWORK: ${network}`);

  return {
    network,
    networkId: `hedera:${network}`,
    treasuryAccountId: required('HEDERA_ACCOUNT_ID'),
    treasuryPrivateKey: required('HEDERA_PRIVATE_KEY'),
    mirrorNodeUrl: process.env['HEDERA_MIRROR_NODE_URL'] ?? (MIRROR_NODES[network] as string),
    maxPaymentAmount: BigInt(process.env['MAX_PAYMENT_AMOUNT'] ?? '100000000'),
    contractAddress: required('COMMON_CONTRACT_ADDRESS'),
    jsonRpcUrl: process.env['HEDERA_JSON_RPC_URL'] ?? JSON_RPC[network] ?? '',
    operatorPrivateKey: process.env['HEDERA_EVM_PRIVATE_KEY'] ?? required('HEDERA_PRIVATE_KEY'),
  };
}
