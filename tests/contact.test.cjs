const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const { webcrypto, randomUUID } = require('node:crypto');
const code = stripTypeScriptTypes(readFileSync(__dirname + '/../supabase/functions/contact/index.ts', 'utf8').replace(/^import .*;\n/gm, ''), { mode: 'transform' });
function setup() {
  let handler; const calls = [];
  const sb = {
    rpc: async (name, payload) => { calls.push({ name, payload }); return { data: name === 'register_tutor_flyer_visit' ? { ok: true } : { id: randomUUID(), duplicate: false, submissions: 1 }, error: null }; },
    from: () => { const q = { select: () => q, eq: () => q, gte: async () => ({ count: 0 }), insert: async () => ({}), update: () => q, not: () => q, delete: () => q, lt: async () => ({}) }; return q; },
  };
  vm.runInNewContext(code, { Deno: { env: { get: name => name === 'RESEND_API_KEY' ? undefined : 'test-only' }, serve: fn => { handler = fn; } },
    createClient: () => sb, crypto: webcrypto, TextEncoder, Request, Response, console,
    fetch: () => { throw Error('No email sending allowed in tests'); } });
  return { calls, request: (body, origin = 'https://lokaltutor.vercel.app') => handler(new Request('https://backend.example', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'User-Agent': 'Test browser' }, body: JSON.stringify(body) })) };
}
test('visit request only registers a visit; no lead or email', async () => {
  const s = setup(); const id = randomUUID();
  assert.equal((await s.request({ action: 'flyer_visit', visit_id: id, flyer_id: 'f4', landing_path: '/eneundervisning.html', is_test: true })).status, 200);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].name, 'register_tutor_flyer_visit');
  assert.equal(s.calls[0].payload.p_test, true);
});
test('accepted contact forwards attribution to atomic RPC', async () => {
  const s = setup(); const id = randomUUID();
  const response = await s.request({ name: 'Test', email: 'test@example.invalid', source: 'hold', elapsed_ms: 5000, flyer_id: 'f5', flyer_visit_id: id });
  assert.equal(response.status, 200);
  assert.equal(s.calls[0].name, 'submit_tutor_lead_with_attribution');
  assert.equal(s.calls[0].payload.payload.flyer_visit_id, id);
  assert.equal((await response.json()).emailSent, false);
});
test('spam, invalid origin and invalid contacts cannot create conversions', async () => {
  for (const body of [{ company: 'bot' }, { elapsed_ms: 100 }, { name: '' }, { name: 'Test', email: 'invalid', elapsed_ms: 5000 }]) {
    const s = setup(); await s.request(body); assert.equal(s.calls.length, 0);
  }
  const s = setup();
  assert.equal((await s.request({ action: 'flyer_visit' }, 'https://evil.example')).status, 403);
  assert.equal(s.calls.length, 0);
});
