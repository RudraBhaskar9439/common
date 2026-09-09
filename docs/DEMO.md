# Demo and submission checklist

## Current runnable example

`npm run demo:mock` reads a fixed purchase, checks freshness and capabilities, retrieves a fixture result and prints a reuse decision. The fixed clock makes it deterministic. It is not the complete hackathon demo.

## Target demo

1. Explain two agents sharing a budget.
2. Start separate agents needing the same dataset.
3. Show one reservation and real payment; the second agent waits.
4. Show indexed discovery, successful result reuse and two completed deliverables.
5. Show a later choice avoiding a known unsuitable result.
6. Inspect the receipt, live Graph record and HCS note.
7. Report purchase spend, fees, successful reuse and task completion.

## Metrics

Reuse rate is successful reuse divided by successful reuse plus successful new acquisition, per distinct resource need. Report failed and denied requests separately. Zero denominator means N/A. Count success only after observed use in a completed deliverable. Estimated avoided cost uses observed quotes; show fees separately.

## Release checks

- [ ] Real payment and indexing paths verified.
- [ ] Critical money and recovery tests pass.
- [ ] Clean install and deployment instructions work.
- [ ] Current prize eligibility and video lengths checked.
- [ ] Public-repository requirement addressed explicitly before submission.
- [ ] No credentials appear in code, logs or video.

References: https://ethglobal.com/events/ethonline2026/prizes/hedera and https://ethglobal.com/events/ethonline2026/prizes/the-graph.
