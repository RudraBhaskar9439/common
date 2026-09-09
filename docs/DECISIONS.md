# Decision log

## Accepted direction

- Build Common with three primary owners: Aditya for Graph, Kavish for Hedera and deployment, Rudra for product and integration.
- Start with a private repository and pre-created module structure.
- Use shared interfaces and mocks to reduce development blocking.

## Scaffold choices for review

- npm workspaces and TypeScript for application/shared packages.
- Node.js 24 LTS for CI; local scaffold also permits Node 25 and 26.
- One package per integration boundary; no frontend or Solidity framework chosen yet.
- Actual live adapters fail explicitly until implemented.

## Pending

- Verified teammate GitHub handles and collaborator access.
- Contract framework and canonical ABI generation.
- Graph-supported deployment path and endpoint.
- Controlled payment signer and settlement architecture.
- Backend framework, frontend framework and persistent data providers.
- Phase 0 interface approval.

## New decision template

Date / owner / decision / reason / affected modules / reviewers / follow-up task.
