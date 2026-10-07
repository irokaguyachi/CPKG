const test = require('node:test');
const assert = require('node:assert/strict');
const { D1 } = require('./helpers/workerHarness.cjs');

const ALL_SCHEMAS = ['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql'];

test('schema applies cleanly', () => {
  const db = new D1(ALL_SCHEMAS);
  const names = db.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name);
  for (const table of ['admin_actions', 'game_bans', 'banned_nicknames', 'tag_vote_locks', 'bump_cancels', 'library_hidden', 'official_tag_overrides']) {
    assert.ok(names.includes(table), table);
  }
  // 두 번 적용해도 깨지지 않는다(원격에 다시 실행해도 안전)
  assert.doesNotThrow(() => new D1([...ALL_SCHEMAS, 'admin_schema.sql']));
});

// ---- 공통 준비 ----
const { load, Bucket, hash, allow, request, clock } = require('./helpers/workerHarness.cjs');
const ADMIN_CODE = 'admin_personal_code_0001';
const OTHER_CODE = 'someone_else_code_0002';
const PASSWORD = 'correct horse battery';

async function setupAdmin(schemas = ALL_SCHEMAS) {
  const admin = (await load('worker/adminApi.js')).default;
  const backend = (await load('worker/favoritesShareWorker.js')).default;
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p) };
  const env = {
    TAGS_DB: new D1(schemas), FAVORITES_BUCKET: new Bucket(),
    ADMIN_USER_HASHES: 'ffff, ' + hash('user-v2:' + ADMIN_CODE),
    ADMIN_PASSWORD: PASSWORD, ADMIN_SESSION_SECRET: 'session-secret-for-tests',
    RL_ADMIN_LOGIN: allow, RL_GAME: allow, RL_GAME_SUBMIT: allow, RL_TAG_WRITE: allow, RL_BUMP_WRITE: allow,
    RL_USER_AUTH: allow, RL_LIB_LIST: allow, RL_LIB_WRITE: allow, GAME_TOKEN_SECRET: 'game-secret',
    ASSETS: { fetch: async req => {
      const p = new URL(req.url).pathname;
      if (p.endsWith('UserTagCatalog.json')) return Response.json(['일상', '로맨스', '피폐']);
      if (p.endsWith('Lookup.json')) return Response.json({ novel: { 123: {}, 456: {}, 789: {} } });
      return Response.json([{ posts: [{ id: 123 }, { id: 456 }] }]);
    } }
  };
  const send = async (worker, method, url, body, headers) => {
    const res = await worker.fetch(request(method, url, body, headers), env, ctx);
    await Promise.all(waits.splice(0));
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  const login = (personalCode = ADMIN_CODE, password = PASSWORD) =>
    send(admin, 'POST', '/api/admin/login', { personalCode, password });
  let token = null;
  const api = async (method, url, body) => {
    if (!token) token = (await login()).body.token;
    return send(admin, method, '/api/admin/' + url, body, { Authorization: 'Bearer ' + token });
  };
  const pub = (method, url, body) => send(backend, method, url, body);
  return { env, admin, backend, send, login, api, pub, setToken: t => { token = t; } };
}

test('login requires both the admin account and the password', async () => {
  const { login } = await setupAdmin();
  const wrongPassword = await login(ADMIN_CODE, 'nope');
  const wrongAccount = await login(OTHER_CODE, PASSWORD);
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongAccount.status, 401);
  assert.deepEqual(wrongPassword.body, wrongAccount.body);
  const ok = await login();
  assert.equal(ok.status, 200);
  assert.match(ok.body.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof ok.body.expiresAt, 'number');
});

test('admin routes fail closed without secrets', async () => {
  for (const name of ['ADMIN_USER_HASHES', 'ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET']) {
    const { env, login, send, admin } = await setupAdmin();
    const token = (await login()).body.token;
    delete env[name];
    assert.equal((await login()).status, 503, name);
    assert.equal((await send(admin, 'GET', '/api/admin/actions', undefined, { Authorization: 'Bearer ' + token })).status, 503, name);
  }
});

test('sessions expire, reject forgery, and die when the admin is removed', async () => {
  const { env, login, send, admin } = await setupAdmin();
  const token = (await login()).body.token;
  const get = t => send(admin, 'GET', '/api/admin/actions', undefined, t ? { Authorization: 'Bearer ' + t } : {});
  assert.equal((await get(token)).status, 200);
  assert.equal((await get(null)).status, 401);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), e: clock.now + 9e9 })).toString('base64url');
  assert.equal((await get(forged + '.' + sig)).status, 401);
  const saved = clock.now;
  clock.now += 12 * 3600000 + 1;
  assert.equal((await get(token)).status, 401);
  clock.now = saved;
  env.ADMIN_USER_HASHES = 'ffff';
  assert.equal((await get(token)).status, 401);
});

test('login is rate limited', async () => {
  const { env, login } = await setupAdmin();
  env.RL_ADMIN_LOGIN = { limit: async () => ({ success: false }) };
  assert.equal((await login()).status, 429);
});

test('admin responses are not cached and not shared cross-origin', async () => {
  const { api } = await setupAdmin();
  const res = await api('GET', 'actions');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

// ---- 랭킹 ----
const player = n => 'player_example_' + String(n).padStart(4, '0');
async function play(t, playerId, scoreMs, nickname) {
  const start = await t.pub('POST', '/game/start', { playerId });
  clock.now += scoreMs + 2800;
  const end = await t.pub('POST', '/game/end', { playerId, runToken: start.body.runToken, scoreMs });
  return t.pub('POST', '/game/submit', { playerId, resultToken: end.body.resultToken, nickname });
}
const playerHash = n => hash('spacegame:' + player(n));

test('admin can delete a weekly or every record of a player', async () => {
  const t = await setupAdmin();
  assert.equal((await play(t, player(1), 30000, '카구야')).status, 200);
  assert.equal((await play(t, player(2), 20000, '야치요')).status, 200);
  const weekly = await t.api('GET', 'game/scores?period=weekly');
  assert.equal(weekly.status, 200);
  assert.deepEqual(weekly.body.items.map(r => [r.nickname, r.scoreMs, r.banned]), [['카구야', 30000, false], ['야치요', 20000, false]]);
  assert.equal(weekly.body.items[0].playerHash, playerHash(1));
  assert.equal(weekly.body.items[0].playerShort, playerHash(1).slice(0, 8));

  let res = await t.api('POST', 'game/delete', { playerHash: playerHash(1), scope: 'period', period: weekly.body.period });
  assert.equal(res.status, 200);
  assert.deepEqual((await t.api('GET', 'game/scores?period=weekly')).body.items.map(r => r.nickname), ['야치요']);
  assert.deepEqual((await t.api('GET', 'game/scores?period=all')).body.items.map(r => r.nickname), ['카구야', '야치요']);

  res = await t.api('POST', 'game/delete', { playerHash: playerHash(1), scope: 'all' });
  assert.equal(res.status, 200);
  assert.deepEqual((await t.pub('POST', '/game/ranking', {})).body.all.map(r => r.nickname), ['야치요']);
  assert.equal((await t.api('POST', 'game/delete', { playerHash: playerHash(1), scope: 'all' })).status, 404);

  const log = (await t.api('GET', 'actions?action=game')).body.items;
  assert.deepEqual(log.map(r => r.action), ['game.delete', 'game.delete']);
  assert.equal(log[0].detail.rows[0].nickname, '카구야');
  assert.equal(log[0].detail.rows[0].period, 'all');
});

test('admin rename applies to every period', async () => {
  const t = await setupAdmin();
  await play(t, player(1), 30000, '나쁜이름');
  assert.equal((await t.api('POST', 'game/rename', { playerHash: playerHash(1), nickname: '  ' })).status, 400);
  assert.equal((await t.api('POST', 'game/rename', { playerHash: playerHash(1), nickname: '플레이어1' })).status, 200);
  const ranking = (await t.pub('POST', '/game/ranking', {})).body;
  assert.equal(ranking.all[0].nickname, '플레이어1');
  assert.equal(ranking.weekly[0].nickname, '플레이어1');
});

test('banned players and banned words cannot submit', async () => {
  const t = await setupAdmin();
  await play(t, player(1), 30000, '카구야');
  assert.equal((await t.api('POST', 'game/ban', { playerHash: playerHash(1), reason: '부정 기록' })).status, 200);
  assert.deepEqual((await t.pub('POST', '/game/ranking', {})).body.all, []);
  let res = await play(t, player(1), 40000, '카구야');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid nickname');
  assert.equal((await t.api('POST', 'game/unban', { playerHash: playerHash(1) })).status, 200);
  assert.equal((await play(t, player(1), 40000, '카구야')).status, 200);

  assert.equal((await t.api('POST', 'game/nicknames/add', { word: '바보' })).status, 200);
  assert.equal((await t.api('POST', 'game/nicknames/add', { word: 'ABC' })).status, 200);
  assert.deepEqual((await t.api('GET', 'game/nicknames')).body.items.map(r => r.word).sort(), ['abc', '바보']);
  assert.equal((await play(t, player(2), 1000, '나는바보')).body.error, 'invalid nickname');
  assert.equal((await play(t, player(2), 1000, 'xAbCx')).body.error, 'invalid nickname');
  assert.equal((await t.api('POST', 'game/nicknames/remove', { word: '바보' })).status, 200);
  assert.equal((await play(t, player(2), 1000, '나는바보')).status, 200);
  const actions = (await t.api('GET', 'actions')).body.items.map(r => r.action);
  assert.deepEqual(actions, ['game.nickname.remove', 'game.nickname.add', 'game.nickname.add', 'game.unban', 'game.ban']);
});

test('public ranking still works when admin tables are missing', async () => {
  const t = await setupAdmin(['game_schema.sql']);
  assert.equal((await play(t, player(1), 30000, '카구야')).status, 200);
});

// ---- 태그 투표 ----
const voter = n => 'voter_personal_code_' + String(n).padStart(4, '0');
async function register(t, code) {
  await t.env.FAVORITES_BUCKET.put('user/' + hash('user-v2:' + code) + '.json', '{}');
}
async function vote(t, n, postId, tagName) {
  await register(t, voter(n));
  return t.pub('POST', '/tags/vote', { personalCode: voter(n), postId, tagName });
}
const voterHash = n => hash('tagvote:' + voter(n));
async function snapshot(t) {
  return JSON.parse((await t.env.FAVORITES_BUCKET.get('tags/snapshot.json')).text).posts;
}

test('admin resets votes per tag or per post and refreshes the snapshot', async () => {
  const t = await setupAdmin();
  await vote(t, 1, 123, '일상');
  await vote(t, 2, 123, '일상');
  await vote(t, 1, 123, '피폐');
  await vote(t, 1, 456, '로맨스');
  const post = await t.api('GET', 'tags/post?postId=123');
  assert.deepEqual(post.body, { postId: 123, locked: false, votes: { 일상: 2, 피폐: 1 } });

  assert.equal((await t.api('POST', 'tags/reset', { postId: 123, tagName: '일상' })).status, 200);
  assert.deepEqual((await t.api('GET', 'tags/post?postId=123')).body.votes, { 피폐: 1 });
  assert.deepEqual(await snapshot(t), { 123: [{ tag: '피폐', votes: 1 }], 456: [{ tag: '로맨스', votes: 1 }] });

  assert.equal((await t.api('POST', 'tags/reset', { postId: 123 })).status, 200);
  assert.deepEqual(Object.keys(await snapshot(t)), ['456']);
  assert.equal((await t.api('POST', 'tags/reset', { postId: 123 })).status, 404);
  const log = (await t.api('GET', 'actions?action=tags')).body.items;
  assert.deepEqual(log.map(r => r.action), ['tags.reset', 'tags.reset']);
  assert.equal(log[1].detail.rows.length, 2);
});

test('recent votes show a short voter id and purging needs an unambiguous prefix', async () => {
  const t = await setupAdmin();
  await vote(t, 1, 123, '일상');
  clock.now += 1000;
  await vote(t, 1, 456, '로맨스');
  clock.now += 1000;
  await vote(t, 2, 123, '일상');
  const recent = (await t.api('GET', 'tags/recent?limit=2')).body.items;
  assert.deepEqual(recent.map(r => [r.postId, r.tagName, r.voter]), [[123, '일상', voterHash(2).slice(0, 8)], [456, '로맨스', voterHash(1).slice(0, 8)]]);

  assert.equal((await t.api('POST', 'tags/purge-voter', { voterPrefix: 'zz' })).status, 400);
  // 투표자 1과 앞 8자가 같은 다른 투표자를 직접 넣어 접두사가 겹치게 만든다
  t.env.TAGS_DB.db.prepare('INSERT INTO tag_votes VALUES (?, ?, ?, ?)').run(456, '일상', voterHash(1).slice(0, 8) + 'f'.repeat(56), clock.now);
  const ambiguous = await t.api('POST', 'tags/purge-voter', { voterPrefix: voterHash(1).slice(0, 8) });
  assert.equal(ambiguous.status, 409);
  assert.equal(t.env.TAGS_DB.rows('SELECT COUNT(*) AS n FROM tag_votes')[0].n, 4);

  const res = await t.api('POST', 'tags/purge-voter', { voterPrefix: voterHash(1).slice(0, 12) });
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, 2);
  assert.deepEqual(t.env.TAGS_DB.rows('SELECT voter_hash FROM tag_votes ORDER BY voter_hash').map(r => r.voter_hash).sort(),
    [voterHash(1).slice(0, 8) + 'f'.repeat(56), voterHash(2)].sort());
  assert.equal((await t.api('POST', 'tags/purge-voter', { voterPrefix: voterHash(1).slice(0, 12) })).status, 404);
});

test('locked posts reject new votes and report locked', async () => {
  const t = await setupAdmin();
  await vote(t, 1, 123, '일상');
  assert.equal((await t.api('POST', 'tags/lock', { postId: 123 })).status, 200);
  const blocked = await vote(t, 2, 123, '일상');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, 'voting locked');
  const got = await t.pub('POST', '/tags/get', { postId: 123 });
  assert.deepEqual(got.body, { votes: { 일상: 1 }, myTags: [], locked: true });
  assert.equal((await t.api('GET', 'tags/post?postId=123')).body.locked, true);
  assert.equal((await t.api('POST', 'tags/unlock', { postId: 123 })).status, 200);
  assert.equal((await vote(t, 2, 123, '일상')).status, 200);
  assert.equal((await t.pub('POST', '/tags/get', { postId: 123 })).body.locked, false);
});

test('tag voting still works when admin tables are missing', async () => {
  const t = await setupAdmin(['tags_schema.sql']);
  assert.equal((await vote(t, 1, 123, '일상')).status, 200);
  assert.deepEqual((await t.pub('POST', '/tags/get', { postId: 123 })).body, { votes: { 일상: 1 }, myTags: [], locked: false });
});

// ---- 끌올 ----
async function bump(t, n, id) {
  await register(t, voter(n));
  return t.pub('POST', '/bump/request', { personalCode: voter(n), type: 'novel', id });
}
const bumpRows = t => t.env.TAGS_DB.rows('SELECT id, item_id, start_at, end_at FROM bumps ORDER BY id');

test('cancelling a waiting bump removes it from the queue', async () => {
  const t = await setupAdmin();
  assert.equal((await bump(t, 1, 123)).status, 201);
  assert.equal((await bump(t, 2, 456)).status, 201);
  const list = (await t.api('GET', 'bumps')).body.items;
  assert.deepEqual(list.map(r => [r.itemId, r.state, r.cancelled]), [[456, 'waiting', false], [123, 'active', false]]);
  assert.equal(list[0].requester, hash('bump:' + voter(2)).slice(0, 8));
  const waiting = list[0];
  assert.equal((await t.api('POST', 'bumps/cancel', { id: waiting.id })).status, 200);
  const pub = (await t.pub('POST', '/bump/get', {})).body;
  assert.equal(pub.waitingCount, 0);
  assert.equal(pub.active.id, 123);
  assert.deepEqual(bumpRows(t).map(r => r.item_id), [123]);
  const log = (await t.api('GET', 'actions?action=bump')).body.items;
  assert.equal(log[0].action, 'bump.cancel');
  assert.equal(log[0].detail.row.item_id, 456);
});

test('cancelling the active bump promotes the next one now', async () => {
  const t = await setupAdmin();
  await bump(t, 1, 123);
  clock.now += 60000;
  await bump(t, 2, 456);
  const active = (await t.api('GET', 'bumps')).body.items.find(r => r.state === 'active');
  assert.equal((await t.api('POST', 'bumps/cancel', { id: active.id })).status, 200);
  const pub = (await t.pub('POST', '/bump/get', {})).body;
  assert.equal(pub.active.id, 456);
  assert.equal(pub.active.startAt, clock.now);
  assert.equal(pub.waitingCount, 0);
  assert.deepEqual((await t.api('GET', 'bumps')).body.items.map(r => [r.itemId, r.state, r.cancelled]), [[456, 'active', false], [123, 'done', true]]);
});

test('cancelling the only active bump shows nothing and the next request starts now', async () => {
  const t = await setupAdmin();
  const db = t.env.TAGS_DB.db;
  // 3시간 전 끌올(이미 교체됨)과 1시간 전에 시작한 지금의 끌올
  db.prepare('INSERT INTO bumps (item_type, item_id, requester_hash, requested_at, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('novel', 789, 'old', clock.now - 3 * 3600000, clock.now - 3 * 3600000, clock.now - 3600000);
  db.prepare('INSERT INTO bumps (item_type, item_id, requester_hash, requested_at, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('novel', 123, 'cur', clock.now - 3600000, clock.now - 3600000, clock.now);
  assert.equal((await t.pub('POST', '/bump/get', {})).body.active.id, 123);
  assert.equal((await t.api('POST', 'bumps/cancel', { id: 2 })).status, 200);
  assert.equal((await t.pub('POST', '/bump/get', {})).body.active, null, 'the replaced bump must not come back');
  assert.equal((await t.api('POST', 'bumps/cancel', { id: 1 })).status, 400, 'finished bumps are not cancellable');

  const again = await bump(t, 3, 123);
  assert.equal(again.status, 201, 'the cancelled item can be bumped again');
  assert.equal(again.body.startAt, clock.now);
  assert.equal((await t.pub('POST', '/bump/get', {})).body.active.id, 123);
});

test('bump endpoints still work without admin tables', async () => {
  const t = await setupAdmin(['bump_schema.sql']);
  assert.equal((await bump(t, 1, 123)).status, 201);
  assert.equal((await bump(t, 2, 123)).status, 409);
  assert.equal((await t.pub('POST', '/bump/get', {})).body.active.id, 123);
});

// ---- 공개 서재 ----
async function publish(t, name) {
  const res = await t.pub('POST', '/library', { name, items: [] });
  assert.equal(res.status, 201);
  return res.body;
}
const publicNames = async t => (await t.pub('GET', '/library')).body.items.map(r => r.name).sort();

test('hidden libraries leave the public list and return 410', async () => {
  const t = await setupAdmin();
  const bad = await publish(t, '나쁜 서재');
  await publish(t, '좋은 서재');
  const list = (await t.api('GET', 'library?q=서재')).body;
  assert.deepEqual(list.items.map(r => [r.name, r.hidden]).sort(), [['나쁜 서재', false], ['좋은 서재', false]]);

  assert.equal((await t.api('POST', 'library/hide', { code: bad.code })).status, 200);
  assert.deepEqual(await publicNames(t), ['좋은 서재']);
  const got = await t.pub('GET', '/library/' + bad.code);
  assert.equal(got.status, 410);
  assert.equal(got.body.error, 'hidden');

  // 주인이 고쳐도 숨김은 유지된다
  assert.equal((await t.pub('PUT', '/library/' + bad.code, { editToken: bad.editToken, name: '고친 서재' })).status, 200);
  assert.deepEqual(await publicNames(t), ['좋은 서재']);
  const admin = (await t.api('GET', 'library')).body;
  assert.deepEqual(admin.hidden.map(r => r.code), [bad.code]);
  assert.equal(admin.items.find(r => r.code === bad.code).hidden, true);

  assert.equal((await t.api('POST', 'library/unhide', { code: bad.code })).status, 200);
  assert.deepEqual(await publicNames(t), ['고친 서재', '좋은 서재']);
  assert.equal((await t.pub('GET', '/library/' + bad.code)).status, 200);
  assert.equal((await t.api('POST', 'library/unhide', { code: bad.code })).status, 404);
});

test('admin can permanently delete a library', async () => {
  const t = await setupAdmin();
  const bad = await publish(t, '지울 서재');
  assert.equal((await t.api('POST', 'library/hide', { code: bad.code })).status, 200);
  const res = await t.api('POST', 'library/delete', { code: bad.code });
  assert.equal(res.status, 200);
  assert.equal(res.body.warning, undefined);
  assert.equal(await t.env.FAVORITES_BUCKET.get('library/' + bad.code + '.json'), null);
  assert.deepEqual(await publicNames(t), []);
  assert.deepEqual((await t.api('GET', 'library')).body.hidden, []);
  assert.equal((await t.api('POST', 'library/delete', { code: bad.code })).status, 404);
  const log = (await t.api('GET', 'actions?action=library')).body.items[0];
  assert.equal(log.action, 'library.delete');
  assert.equal(log.detail.record.name, '지울 서재');
  assert.equal(log.detail.record.editTokenHash, undefined);
  assert.equal(log.detail.record.ownerHash, undefined);
});

test('library endpoints still work without admin tables', async () => {
  const t = await setupAdmin([]);
  const lib = await publish(t, '서재');
  assert.deepEqual(await publicNames(t), ['서재']);
  assert.equal((await t.pub('GET', '/library/' + lib.code)).status, 200);
});

// ---- /admin 진입 차단(확인 쿠키) ----
async function setupGate() {
  const t = await setupAdmin();
  const mod = await load('worker/adminApi.js');
  t.env.ASSETS = { fetch: async req => new Response('ASSET ' + new URL(req.url).pathname, { headers: { 'Content-Type': 'text/plain' } }) };
  t.serve = async (path, cookie) => {
    const res = await mod.serveAdminGate(request('GET', path, undefined, cookie ? { Cookie: cookie } : {}), t.env);
    return res && { status: res.status, headers: res.headers, text: await res.text() };
  };
  t.gate = async personalCode => {
    const res = await t.admin.fetch(request('POST', '/api/admin/gate', { personalCode }), t.env, {});
    return { status: res.status, cookie: res.headers.get('Set-Cookie') };
  };
  return t;
}
const cookiePair = setCookie => setCookie.split(';')[0];

test('without the gate cookie /admin is a tiny redirect page and admin assets are hidden', async () => {
  const t = await setupGate();
  const page = await t.serve('/admin');
  assert.equal(page.status, 200);
  assert.match(page.text, /\/api\/admin\/gate/);
  assert.match(page.text, /location\.replace\('\/'\)/);
  // 쿠키가 저장되지 않는 브라우저에서 무한 새로고침하지 않도록, 한 번 확인한 뒤엔 ?gate=1 로 표시한다
  assert.match(page.text, /gate=1/);
  assert.doesNotMatch(page.text, /ASSET/);
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.equal((await t.serve('/js/pages/adminPage.js')).status, 404);
  assert.equal((await t.serve('/css/pages/admin-page.css')).status, 404);
  assert.equal(await t.serve('/novel'), null, 'other paths are not handled');
});

test('only the admin account receives the gate cookie and it opens the page', async () => {
  const t = await setupGate();
  const denied = await t.gate(OTHER_CODE);
  assert.equal(denied.status, 403);
  assert.equal(denied.cookie, null);
  const ok = await t.gate(ADMIN_CODE);
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^cpkg_admin_gate=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$/);
  const cookie = cookiePair(ok.cookie);
  assert.equal((await t.serve('/admin', cookie)).text, 'ASSET /page/adminPage.html');
  assert.equal((await t.serve('/admin/', cookie)).text, 'ASSET /page/adminPage.html');
  assert.equal((await t.serve('/js/pages/adminPage.js', cookie)).text, 'ASSET /js/pages/adminPage.js');
  assert.equal((await t.serve('/css/pages/admin-page.css', 'other=1; ' + cookie)).text, 'ASSET /css/pages/admin-page.css');
});

test('gate cookies expire, cannot be forged, and die when the admin is removed', async () => {
  const t = await setupGate();
  const cookie = cookiePair((await t.gate(ADMIN_CODE)).cookie);
  const [name, value] = cookie.split('=');
  const [body, sig] = value.split('.');
  const forged = name + '=' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), e: clock.now + 9e10 })).toString('base64url') + '.' + sig;
  assert.match((await t.serve('/admin', forged)).text, /api\/admin\/gate/);
  // 비밀번호 세션 토큰은 확인 쿠키로 쓸 수 없다
  const session = (await t.login()).body.token;
  assert.match((await t.serve('/admin', 'cpkg_admin_gate=' + session)).text, /api\/admin\/gate/);
  const saved = clock.now;
  clock.now += 30 * 86400000 + 1;
  assert.match((await t.serve('/admin', cookie)).text, /api\/admin\/gate/);
  clock.now = saved;
  t.env.ADMIN_USER_HASHES = 'ffff';
  assert.match((await t.serve('/admin', cookie)).text, /api\/admin\/gate/);
});

test('gate clear expires the cookie and gate requests are rate limited', async () => {
  const t = await setupGate();
  const res = await t.admin.fetch(request('POST', '/api/admin/gate/clear', {}), t.env, {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Set-Cookie'), /^cpkg_admin_gate=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);
  t.env.RL_ADMIN_LOGIN = { limit: async () => ({ success: false }) };
  assert.equal((await t.gate(ADMIN_CODE)).status, 429);
});

// ---- 공식 태그 덮어쓰기 ----
test('public official tag overrides default to empty', async () => {
  const t = await setupAdmin([]);
  let res = await t.pub('GET', '/tags/official');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { v: 2, items: {}, tags: null, renames: {} });
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  await t.env.FAVORITES_BUCKET.put('tags/official-overrides.json', JSON.stringify({ v: 1, items: { 'novel:123': ['슬픔'] } }));
  res = await t.pub('GET', '/tags/official');
  assert.deepEqual(res.body.items, { 'novel:123': ['슬픔'] });
});

const officialItems = async t => (await t.pub('GET', '/tags/official')).body.items;

test('admin sets and resets official tags and republishes the overrides', async () => {
  const t = await setupAdmin();
  let res = await t.api('POST', 'official-tags/set', { itemType: 'novel', itemId: 123, tags: [' 슬픔 ', '피폐', '슬픔'], before: ['일상'] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.tags, ['슬픔', '피폐']);
  assert.deepEqual(await officialItems(t), { 'novel:123': ['슬픔', '피폐'] });

  res = await t.api('POST', 'official-tags/set', { itemType: 'novel', itemId: 123, tags: ['새태그'] });
  assert.equal(res.status, 200);
  assert.equal((await t.api('POST', 'official-tags/set', { itemType: 'novel', itemId: 456, tags: [] })).status, 200);
  assert.deepEqual(await officialItems(t), { 'novel:123': ['새태그'], 'novel:456': [] });
  const list = (await t.api('GET', 'official-tags')).body.items;
  assert.deepEqual(list.map(r => [r.itemType, r.itemId, r.tags]).sort(), [['novel', 123, ['새태그']], ['novel', 456, []]]);

  assert.equal((await t.api('POST', 'official-tags/reset', { itemType: 'novel', itemId: 123 })).status, 200);
  assert.deepEqual(await officialItems(t), { 'novel:456': [] });
  assert.equal((await t.api('POST', 'official-tags/reset', { itemType: 'novel', itemId: 123 })).status, 404);

  const log = (await t.api('GET', 'actions?action=official-tags')).body.items;
  assert.deepEqual(log.map(r => r.action), ['official-tags.reset', 'official-tags.set', 'official-tags.set', 'official-tags.set']);
  assert.deepEqual(log[3].detail, { before: ['일상'], after: ['슬픔', '피폐'] });
  assert.deepEqual(log[2].detail.before, ['슬픔', '피폐'], 'an existing override is the before value');
  assert.deepEqual(log[0].detail, { before: ['새태그'], after: null });
});

test('official tag edits are validated', async () => {
  const t = await setupAdmin();
  const bad = [
    { itemType: 'book', itemId: 123, tags: ['a'] },
    { itemType: 'novel', itemId: -1, tags: ['a'] },
    { itemType: 'novel', itemId: 123, tags: ['a,b'] },
    { itemType: 'novel', itemId: 123, tags: ['가'.repeat(21)] },
    { itemType: 'novel', itemId: 123, tags: Array.from({ length: 11 }, (_, i) => 't' + i) },
    { itemType: 'novel', itemId: 123, tags: ['a\u0007'] },
    { itemType: 'novel', itemId: 123, tags: [''] },
    { itemType: 'novel', itemId: 123, tags: 'a' }
  ];
  for (const body of bad) assert.equal((await t.api('POST', 'official-tags/set', body)).status, 400, JSON.stringify(body));
  const unknown = await t.api('POST', 'official-tags/set', { itemType: 'series', itemId: 123, tags: ['a'] });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'unknown item');
  assert.deepEqual(await officialItems(t), {});
  assert.equal(t.env.TAGS_DB.rows('SELECT COUNT(*) AS n FROM official_tag_overrides')[0].n, 0);
});

// ---- 태그 정의 ----
const SAMPLE_DEFS = { v: 1, tags: [{ name: '슬픔', emoji: '💧', color: null, votable: true }], renames: { 짧문: '짧은글' } };
function putDefs(t, doc, version = 1) {
  t.env.TAGS_DB.db.prepare('INSERT OR REPLACE INTO site_documents (key, doc, version, updated_at) VALUES (?, ?, ?, ?)')
    .run('tag-definitions', JSON.stringify(doc), version, 1);
}

test('official tag edits publish the v2 file with tag definitions', async () => {
  const t = await setupAdmin();
  putDefs(t, SAMPLE_DEFS);
  assert.equal((await t.api('POST', 'official-tags/set', { itemType: 'novel', itemId: 123, tags: ['슬픔'] })).status, 200);
  const res = await t.pub('GET', '/tags/official');
  assert.deepEqual(res.body, { v: 2, items: { 'novel:123': ['슬픔'] }, tags: SAMPLE_DEFS.tags, renames: SAMPLE_DEFS.renames });
});

test('tag voting follows votable definitions when present', async () => {
  const t = await setupAdmin();
  assert.equal((await vote(t, 1, 123, '일상')).status, 200);
  assert.equal((await vote(t, 1, 123, '슬픔')).status, 400);
  putDefs(t, SAMPLE_DEFS);
  assert.equal((await vote(t, 2, 123, '슬픔')).status, 200);
  assert.equal((await vote(t, 2, 123, '일상')).status, 400);
});
