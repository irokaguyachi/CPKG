const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');

// 서버 시계. 테스트가 clock.now 를 옮겨서 "그만큼 플레이한 것"처럼 만든다.
const clock = { now: Date.parse('2026-10-03T12:00:00+09:00') };
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock.now])); }
  static now() { return clock.now; }
}

async function load(file) {
  const context = vm.createContext({
    crypto: webcrypto, Request, Response, Headers, URL, TextEncoder, TextDecoder, ReadableStream, console,
    Date: FakeDate, btoa, atob
  });
  const modules = new Map();
  async function moduleFor(filename) {
    filename = path.resolve(filename);
    if (modules.has(filename)) return modules.get(filename);
    const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename });
    modules.set(filename, module);
    await module.link((specifier, parent) => moduleFor(path.resolve(path.dirname(parent.identifier), specifier)));
    return module;
  }
  const module = await moduleFor(path.join(root, file));
  await module.evaluate();
  return module.namespace;
}

// 실제 SQLite 위에 D1 API 중 쓰는 부분(prepare/bind/first/run/all/batch)만 흉내 낸다.
class D1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(fs.readFileSync(path.join(root, 'worker/game_schema.sql'), 'utf8'));
  }
  prepare(sql) { return new Statement(this.db, sql, []); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map(s => s.exec());
      this.db.exec('COMMIT');
      return results;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
class Statement {
  constructor(db, sql, args) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  exec() {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*SELECT/i.test(this.sql)) return { results: stmt.all(...this.args).map(r => ({ ...r })), meta: {} };
    return { results: [], meta: { changes: Number(stmt.run(...this.args).changes) } };
  }
  async first() { return this.exec().results[0] || null; }
  async run() { return this.exec(); }
  async all() { return this.exec(); }
}

const allow = { limit: async () => ({ success: true }) };
const post = (url, body) => new Request('https://example.test' + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
  body: JSON.stringify(body)
});
const player = n => 'player_example_' + String(n).padStart(4, '0');

async function setup() {
  const backend = (await load('worker/favoritesShareWorker.js')).default;
  const env = { TAGS_DB: new D1(), RL_GAME: allow, RL_GAME_SUBMIT: allow, GAME_TOKEN_SECRET: 'test-secret' };
  const call = async (url, body) => {
    const res = await backend.fetch(post(url, body), env);
    return { status: res.status, body: await res.json() };
  };
  // 시작 → (카운트다운 2.8초 + 기록만큼 시간이 흐름) → 종료 → 등록
  const finish = async (playerId, scoreMs, elapsedMs = scoreMs + 2800) => {
    const start = await call('/game/start', { playerId });
    assert.equal(start.status, 201);
    clock.now += elapsedMs;
    return call('/game/end', { playerId, runToken: start.body.runToken, scoreMs });
  };
  const play = async (playerId, scoreMs, nickname) => {
    const end = await finish(playerId, scoreMs);
    assert.equal(end.status, 200, JSON.stringify(end.body));
    return call('/game/submit', { playerId, resultToken: end.body.resultToken, nickname });
  };
  return { env, call, finish, play };
}

test('a played run is ranked on both boards with the player rank', async () => {
  const { play, call } = await setup();
  assert.equal((await play(player(1), 30000, '카구야')).status, 200);
  assert.equal((await play(player(2), 45000, '야치요')).status, 200);
  const res = await play(player(3), 12000, '이로하');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.all.map(r => [r.rank, r.nickname, r.scoreMs]), [[1, '야치요', 45000], [2, '카구야', 30000], [3, '이로하', 12000]]);
  assert.deepEqual(res.body.weekly, res.body.all);
  assert.deepEqual(res.body.me, { all: { rank: 3, scoreMs: 12000 }, weekly: { rank: 3, scoreMs: 12000 } });
  assert.match(res.body.week, /^w\d{4}-\d{2}-\d{2}$/);

  const anonymous = await call('/game/ranking', {});
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body.me, null);
  assert.equal(anonymous.body.all.length, 3);
});

test('start and end write nothing to D1', async () => {
  const { env, finish } = await setup();
  await finish(player(1), 5000);
  const count = table => env.TAGS_DB.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;
  assert.equal(count('game_runs'), 0);
  assert.equal(count('game_scores'), 0);
});

test('forged, paused and slowed-down runs are rejected', async () => {
  const { call, finish } = await setup();
  // 기록이 서버가 잰 시간보다 길다
  let res = await finish(player(1), 10000, 10500);
  assert.equal(res.body.error, 'invalid run');
  // 기록보다 실제 시간이 한참 길다(멈춤·슬로우 모션) — 30초 기록에 60초가 흘렀다
  res = await finish(player(1), 30000, 60000);
  assert.equal(res.body.error, 'run too slow');
  // 경계: 기록 × 1.1 + 6초까지는 봐준다
  assert.equal((await finish(player(1), 30000, 39000)).status, 200);
  assert.equal((await finish(player(1), 30000, 39001)).body.error, 'run too slow');
  // 2시간 지난 판은 끝낼 수 없다
  assert.equal((await finish(player(1), 1000, 2 * 3600000 + 1)).body.error, 'invalid run');

  const start = await call('/game/start', { playerId: player(1) });
  clock.now += 8000;
  // 다른 플레이어의 토큰, 서명을 바꾼 토큰
  res = await call('/game/end', { playerId: player(2), runToken: start.body.runToken, scoreMs: 5000 });
  assert.equal(res.body.error, 'invalid run');
  const [body, sig] = start.body.runToken.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), s: clock.now - 3600000 })).toString('base64url');
  res = await call('/game/end', { playerId: player(1), runToken: forged + '.' + sig, scoreMs: 5000 });
  assert.equal(res.body.error, 'invalid run');
  // run 토큰을 result 토큰처럼 쓸 수 없다
  res = await call('/game/submit', { playerId: player(1), resultToken: start.body.runToken, nickname: 'a' });
  assert.equal(res.body.error, 'invalid run');
});

test('a result is submitted once even if the run is ended twice', async () => {
  const { call } = await setup();
  const playerId = player(1);
  const start = await call('/game/start', { playerId });
  clock.now += 12800;
  const a = await call('/game/end', { playerId, runToken: start.body.runToken, scoreMs: 10000 });
  const b = await call('/game/end', { playerId, runToken: start.body.runToken, scoreMs: 9000 });
  assert.equal((await call('/game/submit', { playerId, resultToken: a.body.resultToken, nickname: 'a' })).status, 200);
  assert.equal((await call('/game/submit', { playerId, resultToken: a.body.resultToken, nickname: 'a' })).body.error, 'invalid run');
  assert.equal((await call('/game/submit', { playerId, resultToken: b.body.resultToken, nickname: 'a' })).body.error, 'invalid run');
});

test('the ranking API closes without a signing secret', async () => {
  const { env, call } = await setup();
  delete env.GAME_TOKEN_SECRET;
  assert.equal((await call('/game/start', { playerId: player(1) })).status, 503);
});

test('only the best score is kept but the newest nickname wins', async () => {
  const { play } = await setup();
  await play(player(1), 40000, '처음 이름');
  const res = await play(player(1), 20000, '새 이름');
  assert.deepEqual(res.body.all, [{ rank: 1, nickname: '새 이름', scoreMs: 40000 }]);
  assert.equal((await play(player(1), 50000, '새 이름')).body.all[0].scoreMs, 50000);
});

test('nicknames are cleaned, length-limited and unique per player', async () => {
  const { play, call } = await setup();
  assert.equal((await play(player(1), 1000, '  카\u200B구   야 ')).body.all[0].nickname, '카구 야');
  const taken = await play(player(2), 2000, '카구 야');
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'nickname taken');
  assert.equal((await play(player(2), 2000, 'ABCDEFGHIJ')).status, 200);
  assert.equal((await play(player(3), 2000, 'abcdefghij')).status, 409, 'case-insensitive');
  assert.equal((await play(player(3), 2000, 'ABCDEFGHIJK')).body.error, 'invalid nickname');
  assert.equal((await play(player(3), 2000, '가나다라마바사아자차')).status, 200);
  assert.equal((await play(player(3), 2000, '\u200B ')).body.error, 'invalid nickname');
  assert.equal((await call('/game/start', { playerId: 'short' })).status, 400);
});
