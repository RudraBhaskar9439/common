# Evaluation runner

Codex implements on Rudra's behalf; proposed review handoff: Aditya. Runs open models through local Ollama against a controlled support-desk browser application. It holds no payment credentials and imports shared types through public exports.

Only the bundled application and supported model tags are runnable. A model produces structured click/fill/select/done actions; the runner operates Playwright and checks final browser state. Model failures and infrastructure errors are separate. Tests may inject explicitly labeled fixture actions; live demonstrations use real Ollama responses.

`npm test --workspace @common/evaluation-runner` checks the browser harness. `npm run demo:models --workspace @common/evaluation-runner` performs real local inference and writes ignored local artifacts. Install Chromium with `npx playwright install chromium` first.
