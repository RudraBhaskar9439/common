# Shared scenario catalog

These are scenarios to implement, not claims of passing tests. Runtime fixtures currently cover one delivered purchase and its result.

| Scenario | Required response or behavior |
| --- | --- |
| Successful purchase | Receipt, amount, operation ID and authorized result |
| Existing reusable result | Delivered, usable, fresh and capability-compatible |
| Pending conflicting reservation | Wait; do not execute another payment |
| Insufficient budget | Typed denial; no reservation or payment |
| Stale result | Reject reuse and attempt authoritative reservation if allowed |
| Unsuitable result | Recorded capability or failure prevents repeated unsuitable choice |
| Unknown settlement | Reconcile; do not release funds or retry blindly |
| Paid delivery failure | Preserve receipt and recorded failure; do not repurchase automatically |
| Delayed Graph index | Discovery may lag; authority still prevents overspending |
| HCS write failure | Retry note independently from payment |

Mocks should be deterministic and expose the same shared types as live implementations. Never place real credentials or private purchased data in fixture files.
