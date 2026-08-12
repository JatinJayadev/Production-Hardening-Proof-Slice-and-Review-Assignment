const { test } = require('node:test');
const assert = require('node:assert');
const { createCircuitBreaker, CircuitOpenError } = require('../src/circuitBreaker');

function fail() {
  return Promise.reject(new Error('provider down'));
}
function ok() {
  return Promise.resolve('drafted');
}

test('stays closed below the minimum request volume', async () => {
  const cb = createCircuitBreaker({ failureThreshold: 0.5, minimumRequests: 5 });
  for (let i = 0; i < 4; i++) {
    await cb.exec(fail).catch(() => {});
  }
  assert.equal(cb.state, 'CLOSED');
  assert.equal(cb.metrics.breaker_open_total, 0);
});

test('opens once failures cross the threshold with enough volume', async () => {
  const cb = createCircuitBreaker({ failureThreshold: 0.5, minimumRequests: 5 });
  for (let i = 0; i < 5; i++) {
    await cb.exec(fail).catch(() => {});
  }
  assert.equal(cb.state, 'OPEN');
  assert.equal(cb.metrics.breaker_open_total, 1);
});

test('short-circuits without calling the dependency while open', async () => {
  const cb = createCircuitBreaker({
    failureThreshold: 0.5,
    minimumRequests: 5,
    openMillis: 1000,
    now: () => 0,
  });
  for (let i = 0; i < 5; i++) {
    await cb.exec(fail).catch(() => {});
  }
  let called = false;
  await assert.rejects(
    () => cb.exec(async () => {
      called = true;
      return ok();
    }),
    CircuitOpenError
  );
  assert.equal(called, false);
  assert.equal(cb.metrics.short_circuited_total, 1);
});

test('probes after the open window and closes on a successful probe', async () => {
  let clock = 0;
  const cb = createCircuitBreaker({
    failureThreshold: 0.5,
    minimumRequests: 5,
    openMillis: 1000,
    now: () => clock,
  });
  for (let i = 0; i < 5; i++) {
    await cb.exec(fail).catch(() => {});
  }
  assert.equal(cb.state, 'OPEN');
  clock = 1000;
  const result = await cb.exec(ok);
  assert.equal(result, 'drafted');
  assert.equal(cb.state, 'CLOSED');
});

test('a failed probe re-opens the circuit', async () => {
  let clock = 0;
  const cb = createCircuitBreaker({
    failureThreshold: 0.5,
    minimumRequests: 5,
    openMillis: 1000,
    now: () => clock,
  });
  for (let i = 0; i < 5; i++) {
    await cb.exec(fail).catch(() => {});
  }
  clock = 1000;
  await cb.exec(fail).catch(() => {});
  assert.equal(cb.state, 'OPEN');
  assert.equal(cb.metrics.breaker_open_total, 2);
});

test('reports state changes for observability', async () => {
  const states = [];
  let clock = 0;
  const cb = createCircuitBreaker({
    failureThreshold: 0.5,
    minimumRequests: 5,
    openMillis: 1000,
    now: () => clock,
    onStateChange: (s) => states.push(s),
  });
  for (let i = 0; i < 5; i++) {
    await cb.exec(fail).catch(() => {});
  }
  clock = 1000;
  await cb.exec(ok);
  assert.deepEqual(states, ['OPEN', 'HALF_OPEN', 'CLOSED']);
});
