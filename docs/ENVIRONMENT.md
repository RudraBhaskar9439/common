# Environment setup

The mock demo needs only Node and npm; no accounts or secrets. Use `npm ci` for reproducible installs.

Module-local `.env.example` files are placeholders for owners to finalize. Copy only the example you need to a same-directory `.env`. The scaffold does not yet load those files or run live services. Never expose signer or Graph credentials in frontend environment variables.

## Live setup owners

- Aditya: Graph provider authentication, endpoint, network and deployment instructions.
- Kavish: Hedera testnet identity, signer security, facilitator URL, contract address, HCS topic, hosted service configuration.
- Rudra: agent provider, backend session/authentication, database and result-store credentials.

Document required variables and fail on missing configuration when implementing live factories. Do not silently fall back to testnet credentials, real-money networks or mocks in deployment.
