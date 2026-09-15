'use strict';

// Circuit breaker for PromptPilot's external model provider.
// The breaker fails fast during sustained provider failures and recovers
// through a single HALF_OPEN probe after the configured cooldown.

class CircuitOpenError extends Error {
  constructor() {
    super('circuit is open');
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
  }
}

function createCircuitBreaker(options = {}) {
  const failureThreshold = options.failureThreshold ?? 0.5;
  const minimumRequests = options.minimumRequests ?? 5;
  const openMillis = options.openMillis ?? 1000;
  const now = options.now ?? Date.now;
  const onStateChange = options.onStateChange ?? function () {};

  const metrics = {
    breaker_open_total: 0,
    short_circuited_total: 0,
    success_total: 0,
    failure_total: 0,
  };

  let state = 'CLOSED';
  let calls = 0;
  let failures = 0;
  let openedAt = null;
  let probeInFlight = false;

  function transition(nextState) {
    if (state === nextState) return;
    state = nextState;
    onStateChange(state);
  }

  function openCircuit() {
    openedAt = now();
    probeInFlight = false;
    metrics.breaker_open_total += 1;
    transition('OPEN');
  }

  async function exec(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError('fn must be a function');
    }

    if (state === 'OPEN') {
      if (now() - openedAt < openMillis) {
        metrics.short_circuited_total += 1;
        throw new CircuitOpenError();
      }

      // Only one request gets to probe the dependency after the cooldown.
      if (probeInFlight) {
        metrics.short_circuited_total += 1;
        throw new CircuitOpenError();
      }

      probeInFlight = true;
      transition('HALF_OPEN');
    }

    const isProbe = state === 'HALF_OPEN';

    try {
      const result = await fn();
      metrics.success_total += 1;

      if (isProbe) {
        probeInFlight = false;
        openedAt = null;
        calls = 0;
        failures = 0;
        transition('CLOSED');
      } else {
        calls += 1;
      }

      return result;
    } catch (err) {
      metrics.failure_total += 1;

      if (isProbe) {
        probeInFlight = false;
        openCircuit();
        throw err;
      }

      calls += 1;
      failures += 1;

      if (
        calls >= minimumRequests &&
        failures / calls >= failureThreshold
      ) {
        openCircuit();
      }

      throw err;
    }
  }

  return {
    exec,
    metrics,
    get state() {
      return state;
    },
  };
}

module.exports = { createCircuitBreaker, CircuitOpenError };
