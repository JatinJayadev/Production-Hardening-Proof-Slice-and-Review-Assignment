# PromptPilot — Circuit Breaker Proof Slice

This PR implements **Option B: Circuit Breaker** for the PromptPilot model-provider call path.

## Risk addressed
Prevents sustained model-provider failures from causing repeated doomed calls and spreading failures through the reply path.

## Chosen control
A circuit breaker in `src/circuitBreaker.js`, already wired into `src/replyService.js`; it fails fast, then recovers through one probe.

## How to run / test
Requires Node.js 18+. Run `node --test` (or `npm test`). Expected result: **6 tests pass, 0 fail**.

## Evidence
The supplied tests prove minimum-request protection, threshold-based opening, dependency-free short-circuiting, successful recovery, failed-probe reopening, and state transitions.

## Observability note
`breaker_open_total` increments on every trip and `short_circuited_total` increments on rejected calls; `onStateChange(state)` exposes `OPEN`, `HALF_OPEN`, and `CLOSED` transitions without logging payloads or secrets.

## Trade-off
During an outage, requests are deliberately rejected by the breaker and rely on PromptPilot's safe fallback instead of waiting on a failing provider.

## Remaining risk
The breaker is in-process, so state and metrics are not shared across multiple service instances; distributed deployments would need shared or aggregated observability and coordinated protection.

## How this production control protects my Modules 1–3 design
It protects the earlier PromptPilot decision to depend on an external model provider by containing provider failure and keeping the support-reply critical path available through the existing human-agent fallback.
