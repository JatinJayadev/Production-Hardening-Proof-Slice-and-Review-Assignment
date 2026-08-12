const { test } = require('node:test');
const assert = require('node:assert');
const { createReplyService, FALLBACK_TEXT } = require('../src/replyService');

function failingProvider() {
  return Promise.reject(new Error('provider down'));
}
function workingProvider() {
  return Promise.resolve('Here is a drafted reply.');
}

test('returns a model draft while the provider is healthy', async () => {
  const svc = createReplyService(workingProvider, { minimumRequests: 5 });
  const r = await svc.draftReply({ id: 1 });
  assert.equal(r.source, 'model');
});

test('degrades to a safe fallback once the circuit opens', async () => {
  const svc = createReplyService(failingProvider, {
    failureThreshold: 0.5,
    minimumRequests: 5,
    openMillis: 1000,
    now: () => 0,
  });
  for (let i = 0; i < 5; i++) {
    await svc.draftReply({ id: i });
  }
  const r = await svc.draftReply({ id: 99 });
  assert.equal(r.source, 'fallback');
  assert.equal(r.text, FALLBACK_TEXT);
  assert.equal(r.reason, 'circuit_open');
  assert.ok(svc.breaker.metrics.short_circuited_total >= 1);
});
