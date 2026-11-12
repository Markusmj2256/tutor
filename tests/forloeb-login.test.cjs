const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const code = stripTypeScriptTypes(
  readFileSync(__dirname + '/../supabase/functions/forloeb-login/index.ts', 'utf8').replace(/^import .*;\n/gm, ''),
  { mode: 'transform' },
);

const PARENT_ID = '11111111-2222-3333-4444-555555555555';

/* En lille efterligning af supabase-js: hver tabel svarer med det, testen har sat op. */
function setup({ parents = [], admins = [], caller = null, recentLog = [], ipCount = 0, resendKey = 'test-key' } = {}) {
  let handler;
  const mails = [];
  const inserts = [];
  const created = [];
  const table = (name) => {
    const state = { head: false, filters: {} };
    const result = () => {
      if (name === 'admin_emails') return { data: admins.map((email) => ({ email })) };
      if (name === 'forloeb_login_log') return state.head ? { count: ipCount } : { data: recentLog };
      if (name === 'forloeb_parents') {
        const rows = parents.filter((p) => (
          (!state.filters.email || p.email === state.filters.email) && (!state.filters.id || p.id === state.filters.id)
        ));
        return { data: rows };
      }
      return { data: [] };
    };
    const q = {
      select: (_cols, opts) => { if (opts && opts.head) state.head = true; return q; },
      eq: (col, value) => { state.filters[col] = value; return q; },
      gte: () => q, lt: () => q, is: () => q, order: () => q, limit: () => q,
      insert: (row) => { inserts.push({ name, row }); return Promise.resolve({}); },
      update: () => q, delete: () => q,
      maybeSingle: () => Promise.resolve({ data: result().data[0] ?? null }),
      then: (resolve) => resolve(result()),
    };
    return q;
  };
  const sb = {
    from: table,
    auth: {
      getUser: async () => ({ data: { user: caller } }),
      admin: {
        createUser: async (args) => { created.push(args); return { error: null }; },
        generateLink: async () => ({ data: { properties: { hashed_token: 'tok+en/123' } }, error: null }),
      },
    },
  };
  vm.runInNewContext(code, {
    Deno: { env: { get: (name) => (name === 'RESEND_API_KEY' ? resendKey : name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'salt' : undefined) }, serve: (fn) => { handler = fn; } },
    createClient: () => sb, crypto: webcrypto, TextEncoder, Request, Response, URLSearchParams,
    console: { ...console, warn() {}, error() {} },
    fetch: async (url, init) => { mails.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); },
  });
  const request = (body, { origin = 'https://lokaltutor.dk', token = 'anon' } = {}) => handler(new Request('https://backend.example', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  }));
  return { request, mails, inserts, created };
}

const emma = { id: PARENT_ID, name: 'Mette Holm', email: 'mette@example.invalid', forloeb: { student: 'Emma Holm' } };

test('ukendt mail: samme svar som en kendt, og ingen mail sendes', async () => {
  const s = setup({ parents: [emma] });
  const res = await s.request({ email: 'fremmed@example.invalid' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(s.mails.length, 0);
  assert.equal(s.created.length, 0);
  assert.equal(s.inserts[0].row.sent, false);
});

test('kendt forælder får et link til /forloeb med engangstoken', async () => {
  const s = setup({ parents: [emma] });
  const res = await s.request({ email: '  Mette@Example.invalid ' });
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(s.mails.length, 1);
  const mail = s.mails[0].body;
  assert.deepEqual(mail.to, ['mette@example.invalid']);
  assert.match(mail.subject, /Emmas forløb/);
  assert.ok(mail.html.includes('https://lokaltutor.dk/forloeb#login=tok%2Ben%2F123'));
  assert.equal(JSON.stringify(s.created[0]), JSON.stringify({ email: 'mette@example.invalid', email_confirm: true }));
  // Loggen må ikke indeholde mailadressen i klartekst.
  assert.ok(!JSON.stringify(s.inserts).includes('mette'));
});

test('for hurtige gentagelser sender ikke en ny mail', async () => {
  const s = setup({ parents: [emma], recentLog: [{ created_at: new Date().toISOString() }] });
  const res = await s.request({ email: 'mette@example.invalid' });
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(s.mails.length, 0);
});

test('for mange forsøg fra samme IP afvises', async () => {
  const s = setup({ parents: [emma], ipCount: 10 });
  assert.equal((await s.request({ email: 'mette@example.invalid' })).status, 429);
  assert.equal(s.mails.length, 0);
});

test('ukendt oprindelse og ugyldig mail afvises', async () => {
  const s = setup({ parents: [emma] });
  assert.equal((await s.request({ email: 'mette@example.invalid' }, { origin: 'https://ond.example' })).status, 403);
  assert.equal((await s.request({ email: 'ikke-en-mail' })).status, 400);
  assert.equal(s.mails.length, 0);
});

test('invitation kræver en indlogget admin', async () => {
  const body = { action: 'invite', parent_id: PARENT_ID };
  const anonymous = setup({ parents: [emma], admins: ['ejer@example.invalid'] });
  assert.equal((await anonymous.request(body)).status, 401);

  const parent = setup({ parents: [emma], admins: ['ejer@example.invalid'], caller: { email: 'mette@example.invalid', email_confirmed_at: 'x' } });
  assert.equal((await parent.request(body)).status, 403);
  assert.equal(parent.mails.length, 0);

  const unconfirmed = setup({ parents: [emma], admins: ['ejer@example.invalid'], caller: { email: 'ejer@example.invalid', email_confirmed_at: null } });
  assert.equal((await unconfirmed.request(body)).status, 401);

  const admin = setup({ parents: [emma], admins: ['Ejer@example.invalid'], caller: { email: 'ejer@example.invalid', email_confirmed_at: 'x' } });
  const res = await admin.request(body);
  assert.equal(res.status, 200);
  assert.equal(admin.mails.length, 1);
  assert.match(admin.mails[0].body.subject, /Følg Emmas forløb/);
});

test('lokalt peger linket på den lokale side', async () => {
  const s = setup({ parents: [emma] });
  await s.request({ email: 'mette@example.invalid' }, { origin: 'http://localhost:8099' });
  assert.ok(s.mails[0].body.html.includes('http://localhost:8099/forloeb.html#login='));
});
