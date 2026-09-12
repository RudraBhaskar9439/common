# web

**Owner:** Rudra

Frontend routes, wallet and workspace views, agent panels, decision cards and spending summary.

## Boundaries

Use `@common/interfaces` for shared contracts. Do not import another workspace's internal source files. Coordinate public interface changes with the lead and affected owner.

## Code locations

- `src/components/`
- `src/features/workspace/`
- `src/features/decisions/`
- `src/features/agents/`
- `src/lib/`
- `public/`

## Current state

The local dashboard is implemented in `public/index.html`, `public/app.js` and `public/style.css`. The public `readWebAsset` export serves only these named assets through the orchestrator. Run `npm run dev` at the repository root and open http://127.0.0.1:3000. It displays model measurements, task artifacts, acquisition/reuse counters and decision history. Local mode explicitly reports zero blockchain payments. Browser sessions and workspace access are enforced by the orchestrator.

## Handoff

Provide setup instructions, example configuration, relevant tests and evidence before marking the component complete.
