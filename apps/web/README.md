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

The local dashboard is implemented in `public/index.html`, `public/app.js` and `public/style.css`. The public `readWebAsset` export serves these named assets and the login.html/login.js/login.css sign-in assets through the orchestrator. Run `npm run dev` at the repository root and open http://127.0.0.1:3000. It displays model measurements, task artifacts, acquisition/reuse counters and decision history. Local mode explicitly reports zero blockchain payments. Browser sessions and workspace access are enforced by the orchestrator.

## Handoff

Provide setup instructions, example configuration, relevant tests and evidence before marking the component complete.

Hosted visitors first see a sign-in form unless `COMMON_PUBLIC_REVIEW=yes`. Public review opens the dashboard without credentials, lets visitors browse existing evidence, and disables spending controls. The sidebar offers operator sign in at `/login`. The password is sent only to the same-origin login endpoint and is never stored by frontend code. The server sets an authenticated HttpOnly cookie, then the frontend opens the dashboard. An expired session returns the user to sign-in.
