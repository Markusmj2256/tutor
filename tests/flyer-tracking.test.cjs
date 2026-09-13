const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { webcrypto, randomUUID } = require('node:crypto');
const source = readFileSync(__dirname + '/../flyer-tracking.js', 'utf8');

function browser(url, reply = async () => ({ ok: true })) {
  const calls = [];
  const links = ['/eneundervisning.html?pakke=20#kontakt', '/holdundervisning.html', '#kontakt', '/admin.html', 'tel:+4524259986', 'https://example.com/'].map(href => ({ href: new URL(href, url).href }));
  const context = { window: {}, location: new URL(url), URL, crypto: webcrypto, AbortSignal,
    document: { visibilityState: 'visible', querySelectorAll: () => links },
    history: { state: null, replaceState(_s, _t, next) { context.location = new URL(next); } },
    fetch: async (_url, options) => { calls.push(JSON.parse(options.body)); const data = await reply(calls.length); return { ok: true, json: async () => data }; },
  };
  vm.runInNewContext(source, context);
  const tracker = context.window.TutorFlyerTracking.init('https://backend.example', 'public-key');
  return { context, tracker, calls, links };
}

test('direct and invalid traffic causes no tracking', async () => {
  for (const query of ['', '?flyer=unknown']) {
    const b = browser('https://lokaltutor.vercel.app/' + query);
    assert.equal(Object.keys(await b.tracker.attribution()).length, 0);
    assert.equal(b.calls.length, 0);
  }
});
test('five flyer links track once and preserve campaign, package and anchor across pages', async () => {
  for (let i = 1; i <= 5; i++) {
    const b = browser('https://lokaltutor.vercel.app/?flyer=f' + i);
    const a = await b.tracker.attribution();
    await b.tracker.attribution();
    assert.equal(b.calls.length, 1);
    assert.equal(a.flyer_id, 'f' + i);
    const next = new URL(b.links[0].href);
    assert.equal(next.searchParams.get('fv'), a.flyer_visit_id);
    assert.equal(next.searchParams.get('pakke'), '20');
    assert.equal(next.hash, '#kontakt');
    assert.equal(b.links[3].href, 'https://lokaltutor.vercel.app/admin.html');
    assert.equal(b.links[4].href, 'tel:+4524259986');
    const follow = browser(next.href);
    const f = await follow.tracker.attribution();
    assert.equal(f.flyer_visit_id, a.flyer_visit_id);
  }
});
test('reload uses same ID; expired or mismatched ID rotates', async () => {
  const id = randomUUID();
  const b = browser(`https://lokaltutor.vercel.app/?flyer=f1&fv=${id}`, async n => n === 1 ? { existing: true, ok: false } : { ok: true });
  const a = await b.tracker.attribution();
  assert.notEqual(a.flyer_visit_id, id);
  assert.equal(b.calls.length, 2);
  assert.equal(new URL(b.links[1].href).searchParams.get('fv'), a.flyer_visit_id);
});
test('network failure leaves forms usable and allows a later retry', async () => {
  let fail = true;
  const b = browser('https://lokaltutor.vercel.app/?flyer=f1', async () => { if (fail) throw Error('offline'); return { ok: true }; });
  assert.equal(Object.keys(await b.tracker.attribution()).length, 0);
  fail = false;
  assert.equal((await b.tracker.attribution()).flyer_id, 'f1');
});
test('test flag follows navigation', async () => {
  const b = browser('https://lokaltutor.vercel.app/?flyer=f5&tracking_test=1');
  await b.tracker.attribution();
  assert.equal(b.calls[0].is_test, true);
  assert.equal(new URL(b.links[0].href).searchParams.get('tracking_test'), '1');
});
