// Loads contracts/.env, which is git-ignored. Shell variables still win over the file.
require('dotenv').config();
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
require('@nomicfoundation/hardhat-toolbox');

/**
 * Hedera exposes an EVM-compatible JSON-RPC relay, so standard Hardhat tooling works.
 * Credentials come from the environment only. Never commit a key.
 */
const testnetKey = process.env.HEDERA_EVM_PRIVATE_KEY;

module.exports = {
  solidity: {
    version: '0.8.24',
    // viaIR: `reserve` takes 10 arguments plus locals, which overflows the legacy
    // pipeline's stack. The IR pipeline handles it and keeps the ABI unchanged, so
    // the subgraph's event signatures are unaffected. Compiles are slower.
    settings: { viaIR: true, optimizer: { enabled: true, runs: 200 } },
  },
  paths: { sources: './src', tests: './test', cache: './cache', artifacts: './artifacts' },
  networks: {
    hardhat: {},
    hederaTestnet: {
      url: process.env.HEDERA_JSON_RPC_URL || 'https://testnet.hashio.io/api',
      chainId: 296,
      accounts: testnetKey ? [testnetKey] : [],
    },
  },
};
