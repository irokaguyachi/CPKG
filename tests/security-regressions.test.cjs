const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');

async function load(file, overrides = {}) {
  const context = vm.createContext({
    crypto: webcrypto, Request, Response, Headers, URL, TextEncoder, TextDecoder,
    ReadableStream, console, ...overrides
  });
  const modules = new Map();
  async function moduleFor(filename) {
    filename = path.resolve(filename);
    if (modules.has(filename)) return modules.get(filename);
    const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), {
      context, identifier: filename
    });
    modules.set(filename, module);
    await module.link((specifier, parent) => moduleFor(path.resolve(path.dirname(parent.identifier), specifier)));
    return module;
  }
  const module = await moduleFor(path.join(root, file));
  await module.evaluate();
  return module.namespace;
}

class Bucket {
  constructor(pageSize = 1000) { this.objects = new Map(); this.version = 0; this.lists = 0; this.pageSize = pageSize; }
  async get(key) {
    const value = this.objects.get(key);
    if (!value) return null;
    return { ...value, json: async () => JSON.parse(value.text), body: new Response(value.text).body };
  }
  async head(key) { return this.objects.get(key) || null; }
  async put(key, text, options = {}) {
    const existing = this.objects.get(key);
    const condition = options.onlyIf || {};
    if (condition.etagMatches && (!existing || existing.etag !== condition.etagMatches)) return null;
    if (condition.etagDoesNotMatch === '*' && existing) return null;
    const value = { key, text, etag: String(++this.version), customMetadata: options.customMetadata || {} };
    this.objects.set(key, value);
    return value;
  }
  async delete(key) { this.objects.delete(key); }
  async list({ prefix, cursor, limit }) {
    this.lists++;
    const rows = [...this.objects.values()].filter(row => row.key.startsWith(prefix)).sort((a, b) => a.key < b.key ? -1 : 1);
    const offset = Number(cursor) || 0;
    const end = offset + Math.min(limit, this.pageSize);
    return { objects: rows.slice(offset, end), truncated: end < rows.length, cursor: String(end) };
  }
}
function envFor(bucket = new Bucket()) {
  const allow = { limit: async () => ({ success: true }) };
  return {
    FAVORITES_BUCKET: bucket, RL_USER_AUTH: allow, RL_TAG_WRITE: allow, RL_LIB_LIST: allow,
    RL_LIB_WRITE: allow, RATE_LIMIT_KV: { get: async () => null },
    ASSETS: { fetch: async request => Response.json(new URL(request.url).pathname.includes('UserTagCatalog')
      ? ['일상'] : [{ posts: [{ id: 123 }] }]) }
  };
}
const hash = text => createHash('sha256').update(text).digest('hex');
const personalCode = index => 'account_example_' + String(index).padStart(4, '0');
const request = (url, body, headers = {}) => new Request('https://example.test' + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers },
  body: JSON.stringify(body)
});

test('body limit counts UTF-8 bytes and cancels oversized streams without draining them', async () => {
  const { readJsonLimited } = await load('worker/requestBody.js');
  let result = await readJsonLimited(request('/', { text: '가'.repeat(20) }), 50);
  assert.equal(result.status, 413);
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(80)); }, cancel() { cancelled = true; } });
  result = await readJsonLimited(new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half' }), 100);
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 4);
  const json = JSON.stringify({ text: '안녕' });
  assert.equal((await readJsonLimited(new Request('https://example.test', { method: 'POST', body: json }), Buffer.byteLength(json))).value.text, '안녕');
  assert.equal((await readJsonLimited(new Request('https://example.test', { method: 'POST', body: '{' }), 100)).status, 400);
});

test('tag votes require an existing account and a real novel post', async () => {
  const { default: backend } = await load('worker/favoritesShareWorker.js');
  const env = envFor();
  let writes = 0;
  env.TAGS_DB = { prepare: () => ({ bind() { return this; }, first: async () => null, run: async () => { writes++; return { meta: { changes: 1 } }; } }) };
  const payload = { personalCode: personalCode(1), postId: 123, tagName: '일상' };
  assert.equal((await backend.fetch(request('/tags/vote', payload), env)).status, 401);
  await env.FAVORITES_BUCKET.put('user/' + hash('user-v2:' + payload.personalCode) + '.json', '{}');
  assert.equal((await backend.fetch(request('/tags/vote', { ...payload, postId: 99999 }), env)).status, 400);
  assert.equal(writes, 0);
  assert.equal((await backend.fetch(request('/tags/vote', payload), env)).status, 200);
  assert.equal(writes, 1);
});

test('unregistered library owners cannot manufacture legacy accounts to bypass signup', async () => {
  const { default: backend } = await load('worker/favoritesShareWorker.js');
  const response = await backend.fetch(request('/library', { personalCode: personalCode(1), name: 'test', items: [] }), envFor());
  assert.equal(response.status, 401);
});

test('anonymous shares cannot be claimed to manufacture an unregistered account', async () => {
  const { default: backend } = await load('worker/favoritesShareWorker.js');
  const env = envFor();
  const published = await backend.fetch(request('/library', { name: 'test', items: [] }), env);
  assert.equal(published.status, 201);
  const { code, editToken } = await published.json();
  const claimed = await backend.fetch(request('/library/' + code + '/claim-owner', {
    editToken, personalCode: personalCode(99)
  }), env);
  assert.equal(claimed.status, 401);
  assert.equal((await backend.fetch(request('/user/get', { personalCode: personalCode(99) }), env)).status, 404);
});

test('concurrent signups cannot exceed five accounts per IP per day', async () => {
  const { default: backend } = await load('worker/favoritesShareWorker.js');
  const env = envFor();
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => backend.fetch(request('/user/signup', { personalCode: personalCode(i) }), env)));
  assert.equal(responses.filter(r => r.status === 201).length, 5);
  assert.ok(responses.every(r => r.status === 201 || r.status === 429));
  assert.equal([...env.FAVORITES_BUCKET.objects.keys()].filter(key => key.startsWith('user/')).length, 5);
});

test('signup reservations are idempotent and existing accounts do not consume quota', async () => {
  const { default: backend } = await load('worker/favoritesShareWorker.js');
  const env = envFor();
  const responses = await Promise.all(Array.from({ length: 8 }, () => backend.fetch(request('/user/signup', { personalCode: personalCode(0) }), env)));
  assert.equal(responses.filter(r => r.status === 201).length, 1);
  assert.ok(responses.every(r => r.ok));
  for (let i = 1; i < 5; i++) assert.equal((await backend.fetch(request('/user/signup', { personalCode: personalCode(i) }), env)).status, 201);
  assert.equal((await backend.fetch(request('/user/signup', { personalCode: personalCode(5) }), env)).status, 429);
  assert.equal((await backend.fetch(request('/user/signup', { personalCode: personalCode(0) }), env)).status, 200);
});

test('quota errors fail closed for signup; legacy daily counts are preserved', async () => {
  const { default: backend } = await load('worker/favoritesShareWorker.js');
  const env = envFor();
  env.RATE_LIMIT_KV.get = async () => '5';
  assert.equal((await backend.fetch(request('/user/signup', { personalCode: personalCode(0) }), env)).status, 429);
  env.RATE_LIMIT_KV.get = async () => { throw new Error('offline'); };
  assert.equal((await backend.fetch(request('/user/signup', { personalCode: personalCode(0) }), env)).status, 503);
  assert.equal([...env.FAVORITES_BUCKET.objects.keys()].filter(key => key.startsWith('user/')).length, 0);
});

function presenceState() {
  const state = { writes: 0, alarmAt: null, data: new Map(), blockConcurrencyWhile: async fn => fn() };
  state.storage = {
    get: async keys => new Map(keys.filter(key => state.data.has(key)).map(key => [key, structuredClone(state.data.get(key))])),
    put: async values => { state.writes++; for (const [key, value] of Object.entries(values)) state.data.set(key, structuredClone(value)); },
    getAlarm: async () => state.alarmAt,
    setAlarm: async value => { state.alarmAt = value; }
  };
  return state;
}

test('presence binds sessions to clients, bounds admission and batches storage writes', async () => {
  let now = 1800000000000;
  class Clock extends Date { static now() { return now; } }
  const { PresenceDO } = await load('worker/presenceDO.js', { Date: Clock });
  const state = presenceState();
  const object = new PresenceDO(state, {});
  const client = 'a'.repeat(32);
  for (let i = 0; i < 10; i++) {
    const r = await object.fetch(request('/beat', { sid: i.toString(16).padStart(16, '0') }, { 'X-Presence-Client': client }));
    assert.equal(r.status, 200);
  }
  assert.equal((await object.fetch(request('/beat', { sid: 'f'.repeat(16) }, { 'X-Presence-Client': client }))).status, 429);
  assert.equal(state.writes, 1);
  const leave = await object.fetch(request('/leave', { sid: '0'.repeat(16) }, { 'X-Presence-Client': 'b'.repeat(32) }));
  assert.equal((await leave.json()).online, 10);
  now += 80000;
  state.alarmAt = null;
  await object.alarm();
  assert.equal(state.data.get('sessions').length, 0);
  assert.equal(state.data.get('peak').allTime, 10);
  assert.equal(state.writes, 2);
});

test('presence gateway rejects cross-site calls and oversized input before the DO', async () => {
  const { default: api } = await load('worker/statsApi.js');
  const env = { PRESENCE: { idFromName() { throw new Error('must not reach DO'); } } };
  assert.equal((await api.fetch(request('/api/presence/beat', { sid: 'a'.repeat(16) }, { Origin: 'https://evil.test' }), env)).status, 403);
  assert.equal((await api.fetch(request('/api/presence/beat', { sid: 'a'.repeat(500) }), env)).status, 413);
  assert.equal((await api.fetch(request('/api/presence/beat', { sid: 'bad' }), env)).status, 400);
});

async function seedLibrary(bucket, count) {
  for (let i = 0; i < count; i++) {
    await bucket.put('library/' + String(i).padStart(8, '0') + '.json', '{}', {
      customMetadata: { name: '작품 ' + i, itemCount: '1', createdAt: String(i), updatedAt: String(i) }
    });
  }
}
test('index includes more than 4000 entries and repeat reads do not scan R2', async () => {
  const index = await load('worker/libraryIndex.js');
  const bucket = new Bucket();
  await seedLibrary(bucket, 4501);
  const env = envFor(bucket);
  assert.equal((await index.readLibraryIndex(env)).length, 4501);
  const lists = bucket.lists;
  assert.equal((await index.readLibraryIndex(env)).length, 4501);
  assert.equal(bucket.lists, lists);
  const { default: backend } = await load('worker/favoritesShareWorker.js');
  const response = await backend.fetch(new Request('https://example.test/library?sort=new&limit=1'), env);
  const result = await response.json();
  assert.equal(result.total, 4501);
  assert.equal(result.items[0].code, '00004500');
  assert.equal(bucket.lists, lists);
});

test('index scans resume without exposing partial data and mutations update the snapshot', async () => {
  const index = await load('worker/libraryIndex.js');
  const bucket = new Bucket(2);
  await seedLibrary(bucket, 19);
  const env = envFor(bucket);
  assert.equal(await index.readLibraryIndex(env), null);
  assert.equal((await index.refreshLibraryIndex(env)).length, 19);
  await index.updateLibraryIndex(env, '00000000', { name: '변경', items: [], createdAt: 1, updatedAt: 2 });
  assert.equal((await index.readLibraryIndex(env)).find(row => row.code === '00000000').name, '변경');
  await index.updateLibraryIndex(env, '00000000', null);
  assert.equal((await index.readLibraryIndex(env)).length, 18);
});

test('a cron scan cannot overwrite an index mutation made while scanning', async () => {
  const index = await load('worker/libraryIndex.js');
  const env = envFor();
  await seedLibrary(env.FAVORITES_BUCKET, 3);
  await index.refreshLibraryIndex(env);
  const list = env.FAVORITES_BUCKET.list.bind(env.FAVORITES_BUCKET);
  env.FAVORITES_BUCKET.list = async options => {
    const result = await list(options);
    await index.updateLibraryIndex(env, '00000000', { name: 'newer', items: [], createdAt: 0, updatedAt: 100 });
    return result;
  };
  assert.equal(await index.refreshLibraryIndex(env), null);
  assert.equal((await index.readLibraryIndex(env)).find(row => row.code === '00000000').name, 'newer');
});

test('publish, edit and delete immediately update the public list', async () => {
  const { default: backend } = await load('worker/favoritesShareWorker.js');
  const index = await load('worker/libraryIndex.js');
  const env = envFor();
  await index.refreshLibraryIndex(env);
  const created = await backend.fetch(request('/library', { name: 'before', items: [] }), env);
  const { code, editToken } = await created.json();
  assert.equal((await index.readLibraryIndex(env))[0].name, 'before');
  const edit = new Request('https://example.test/library/' + code, {
    method: 'PUT', body: JSON.stringify({ editToken, name: 'after' })
  });
  assert.equal((await backend.fetch(edit, env)).status, 200);
  assert.equal((await index.readLibraryIndex(env))[0].name, 'after');
  const remove = new Request('https://example.test/library/' + code, {
    method: 'DELETE', body: JSON.stringify({ editToken })
  });
  assert.equal((await backend.fetch(remove, env)).status, 200);
  assert.equal((await index.readLibraryIndex(env)).length, 0);
});

test('markdown does not create event attributes, reinterpret generated HTML, or replace ordinary numbers', () => {
  const source = fs.readFileSync(path.join(root, 'src/js/pages/changelogPage.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('  function escapeHtml'), source.indexOf('  function formatDate')), context);
  assert.equal(context.renderMarkdown('버전 123 업데이트'), '<p>버전 123 업데이트</p>');
  assert.equal(context.renderMarkdown('버전 `123` 업데이트'), '<p>버전 <code>123</code> 업데이트</p>');
  assert.equal(context.renderMarkdown('**굵게** *기울임*'), '<p><strong>굵게</strong> <em>기울임</em></p>');
  const injection = context.renderMarkdown('[link](https://example.test/" onpointerenter="window.__audit=1)');
  assert.equal(injection, '<p><a href="#" target="_blank" rel="noopener noreferrer">link</a></p>');
  assert.ok(context.renderMarkdown('[link](javascript:alert)').includes('href="#"'));
  assert.ok(context.renderMarkdown('[link](https://example.test/**part**)').includes('href="https://example.test/**part**"'));
  assert.ok(context.renderMarkdown('<img src=x onerror=alert>').includes('&lt;img'));
});
