// 프로필 활동 기록·조회(worker/profileStats.js) 검증: 하루 한도, 중복 무시, 연결 이후 투표만, 끌올 옮겨 담기.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, D1, hash, clock, root } = require('./helpers/workerHarness.cjs');
const { setupDisplay, withClock, code, BASE_SCHEMAS } = require('./helpers/profileSetup.cjs');

const DAY = 86400000;
const keys = (n, from = 0) => Array.from({ length: n }, (_, i) => 'novel:' + (from + i + 1));

async function setup() {
  const stats = await load('worker/profileStats.js');
  const t = await setupDisplay();
  await t.account(code(1));
  const profileId = await t.makeProfile(code(1));
  return { stats, t, env: t.env, profileId };
}

test('recordView counts each work once', withClock(async () => {
  const { stats, env, profileId } = await setup();
  assert.equal(await stats.recordView(env, profileId, 'novel:5', clock.now), true);
  assert.equal(await stats.recordView(env, profileId, 'novel:5', clock.now), false);
  assert.equal((await stats.readStats(env, profileId)).viewed, 1);
}));

test('recordView caps a KST day at 200', withClock(async () => {
  const { stats, env, profileId } = await setup();
  const all = keys(201);
  for (let i = 0; i < 200; i++) assert.equal(await stats.recordView(env, profileId, all[i], clock.now), true);
  assert.equal(await stats.recordView(env, profileId, all[200], clock.now), false);
  assert.equal((await stats.readStats(env, profileId)).viewed, 200);
  // KST 다음 날 00:00 이 되면 다시 들어간다
  clock.now = stats.kstDayStart(clock.now) + DAY;
  assert.equal(await stats.recordView(env, profileId, all[200], clock.now), true);
  assert.equal((await stats.readStats(env, profileId)).viewed, 201);
}));

test('recordSaves caps a day at 200 and continues the next day', withClock(async () => {
  const { stats, env, profileId } = await setup();
  const all = keys(250);
  assert.equal(await stats.recordSaves(env, profileId, all, clock.now), 200);
  assert.equal((await stats.readStats(env, profileId)).saved, 200);
  clock.now = stats.kstDayStart(clock.now) + DAY;
  assert.equal(await stats.recordSaves(env, profileId, all, clock.now), 50);
  assert.equal((await stats.readStats(env, profileId)).saved, 250);
}));

test('recordSaves ignores keys already saved when counting the limit', withClock(async () => {
  const { stats, env, profileId } = await setup();
  assert.equal(await stats.recordSaves(env, profileId, keys(150), clock.now), 150);
  // 같은 날에는 남은 한도(50)까지만 들어간다
  assert.equal(await stats.recordSaves(env, profileId, keys(10, 500), clock.now), 10);
  // 다음 날: 이미 있는 150개는 한도에 세지 않고 새 60개가 모두 들어간다
  clock.now = stats.kstDayStart(clock.now) + DAY;
  assert.equal(await stats.recordSaves(env, profileId, keys(150).concat(keys(60, 1000)), clock.now), 60);
  assert.equal((await stats.readStats(env, profileId)).saved, 220);
}));

test('readStats counts votes after linked_at only', withClock(async () => {
  const stats = await load('worker/profileStats.js');
  const t = await setupDisplay();
  const c = code(2);
  await t.account(c);
  // 프로필 전 투표 1
  assert.equal((await t.vote(c, 123, '일상')).status, 200);
  t.tick();
  const profileId = await t.makeProfile(c);
  assert.equal((await t.send('POST', '/profile/me', { personalCode: c })).status, 200);
  t.tick();
  // 연결 뒤: 다른 게시물 투표 2(같은 게시물 다른 태그 1 포함)
  assert.equal((await t.vote(c, 456, '일상')).status, 200);
  assert.equal((await t.vote(c, 456, '로맨스')).status, 200);
  assert.equal((await t.vote(c, 789, '일상')).status, 200);
  assert.equal((await stats.readStats(t.env, profileId)).voted, 2);
}));

test('readStats without a link row counts votes as 0', withClock(async () => {
  const { stats, t, env, profileId } = await setup();
  assert.equal((await t.vote(code(1), 123, '일상')).status, 200);
  env.TAGS_DB.db.exec('DELETE FROM profile_links');
  assert.deepEqual({ ...await stats.readStats(env, profileId) }, { viewed: 0, saved: 0, voted: 0, bumped: 0 });
}));

test('recordBump records only for accounts with a profile', withClock(async () => {
  const { stats, env, profileId } = await setup();
  await stats.recordBump(env, code(9), 16, clock.now);
  assert.equal(env.TAGS_DB.rows('SELECT * FROM profile_activity').length, 0);
  await stats.recordBump(env, code(1), 17, clock.now);
  const found = env.TAGS_DB.rows('SELECT * FROM profile_activity');
  assert.equal(found.length, 1);
  assert.equal(found[0].profile_id, profileId);
  assert.equal(found[0].kind, 'bump');
  assert.equal(found[0].item_key, '17');
  assert.equal((await stats.readStats(env, profileId)).bumped, 1);
}));

test('itemKey accepts only a known type and a non-negative integer', async () => {
  const stats = await load('worker/profileStats.js');
  assert.equal(stats.itemKey('novel', 5), 'novel:5');
  assert.equal(stats.itemKey('hof', 0), 'hof:0');
  assert.equal(stats.itemKey('bogus', 5), null);
  assert.equal(stats.itemKey('novel', -1), null);
  assert.equal(stats.itemKey('novel', 1.5), null);
  assert.equal(stats.itemKey('novel', '5'), null);
});

test('delete statements remove activity rows', withClock(async () => {
  const { stats, env, profileId } = await setup();
  await stats.recordView(env, profileId, 'novel:1', clock.now);
  await stats.recordBump(env, code(1), 17, clock.now);
  await stats.deleteBumpStatement(env, 17).run();
  assert.equal((await stats.readStats(env, profileId)).bumped, 0);
  assert.equal((await stats.readStats(env, profileId)).viewed, 1);
  await stats.deleteActivityStatement(env, profileId).run();
  assert.equal(env.TAGS_DB.rows('SELECT * FROM profile_activity').length, 0);
}));

test('stats schema backfills current bumps after linked_at, skipping cancelled ones', async () => {
  const d1 = new D1([...BASE_SCHEMAS, 'profile_schema.sql']);
  const bumpHash = hash('bump:' + code(3));
  d1.db.exec("INSERT INTO profile_links (profile_id, vote_hash, bump_hash, game_hash, linked_at) VALUES ('P1', 'v', '" + bumpHash + "', 'g', 1000)");
  const add = (id, at) => d1.db.exec('INSERT INTO bumps (id, item_type, item_id, requester_hash, requested_at, start_at, end_at) VALUES (' +
    id + ", 'novel', 1, '" + bumpHash + "', " + at + ', ' + at + ', ' + (at + 1) + ')');
  add(1, 500); add(2, 2000); add(3, 3000);
  d1.db.exec('INSERT INTO bump_cancels (bump_id, cancelled_at) VALUES (3, 4000)');
  const sql = fs.readFileSync(path.join(root, 'worker', 'stats_schema.sql'), 'utf8');
  d1.db.exec(sql);
  const found = d1.rows('SELECT * FROM profile_activity');
  assert.equal(found.length, 1);
  assert.deepEqual({ ...found[0] }, { profile_id: 'P1', kind: 'bump', item_key: '2', at: 2000 });
  d1.db.exec(sql);
  assert.equal(d1.rows('SELECT * FROM profile_activity').length, 1);
});

test('POST /profile/view counts once and reports counted', withClock(async () => {
  const { t, profileId } = await setup();
  const view = id => t.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id });
  assert.deepEqual((await view(123)).body, { ok: true, counted: true });
  assert.deepEqual((await view(123)).body, { ok: true, counted: false });
  const res = await t.send('GET', '/profile/stats?id=' + profileId);
  assert.equal(res.body.viewed, 1);
}));

test('POST /profile/view rejects bad shapes and unknown posts', withClock(async () => {
  const { t } = await setup();
  const view = (type, id) => t.send('POST', '/profile/view', { personalCode: code(1), type, id });
  for (const [type, id] of [['poem', 123], ['novel', 1.5], ['novel', '123'], ['novel', -1]]) {
    const res = await view(type, id);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid payload shape');
  }
  const bad = await t.send('POST', '/profile/view', { type: 'novel', id: 123 });
  assert.equal(bad.status, 400);
  const unknown = await view('novel', 999);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'unknown post');
  // 프로필이 없는 호출은 Lookup 을 보기 전에 끝나므로, 없는 작품이어도 counted:false 다
  await t.account(code(5));
  const noProfile = await t.send('POST', '/profile/view', { personalCode: code(5), type: 'novel', id: 999 });
  assert.equal(noProfile.status, 200);
  assert.deepEqual(noProfile.body, { ok: true, counted: false });
}));

test('POST /profile/view without a profile is a no-op', withClock(async () => {
  const { t, env } = await setup();
  await t.account(code(5));
  const res = await t.send('POST', '/profile/view', { personalCode: code(5), type: 'novel', id: 123 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, counted: false });
  assert.equal(env.TAGS_DB.rows('SELECT * FROM profile_activity').length, 0);
}));

test('GET /profile/stats returns four numbers with a 60s public cache', withClock(async () => {
  const { t, profileId } = await setup();
  const { backend, request } = { backend: (await load('worker/favoritesShareWorker.js')).default, request: require('./helpers/workerHarness.cjs').request };
  const res = await backend.fetch(request('GET', '/profile/stats?id=' + profileId), t.env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  assert.deepEqual(Object.keys(await res.json()), ['viewed', 'saved', 'voted', 'bumped']);
}));

test('GET /profile/stats: bad id 400, unknown id 404, missing table 503', withClock(async () => {
  const { t } = await setup();
  assert.equal((await t.send('GET', '/profile/stats?id=short')).status, 400);
  assert.equal((await t.send('GET', '/profile/stats')).status, 400);
  const missing = await t.send('GET', '/profile/stats?id=AAAAAAAAAAAA');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'profile not found');
  // 통계 표가 없는 D1
  const bare = await setupDisplay([...BASE_SCHEMAS, 'profile_schema.sql']);
  await bare.account(code(1));
  const id = await bare.makeProfile(code(1));
  const res = await bare.send('GET', '/profile/stats?id=' + id);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'stats unavailable');
  const view = await bare.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id: 123 });
  assert.equal(view.status, 503);
}));

test('both paths are listed in API_EXACT_PATHS', () => {
  const src = fs.readFileSync(path.join(root, 'src', '_worker.js'), 'utf8');
  assert.ok(src.includes("'/profile/view'"));
  assert.ok(src.includes("'/profile/stats'"));
});

// ---- Task 3: 기존 경로(동기화·끌올·삭제)에 기록·삭제 붙이기 ----
const { setupDisplayAdmin } = require('./helpers/adminSetup.cjs');

async function signup(t, c) {
  const res = await t.send('POST', '/user/signup', { personalCode: c });
  assert.equal(res.status, 201, JSON.stringify(res.body));
}

// 북마크 하나에 novel ids 를 담아 동기화한다. 계정마다 syncVersion 을 이어 간다.
function syncer(t, c) {
  let version = 1;
  return async ids => {
    const res = await t.send('PUT', '/user/sync', {
      personalCode: c, clientSyncVersion: version,
      data: { version: 2, deletedBookmarks: [], bookmarks: [{ id: 'b1', name: '북마크', items: ids.map(id => ({ type: 'novel', id, addedAt: 1 })) }] }
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    version = res.body.serverSyncVersion;
    return res;
  };
}

const statsOf = async (t, profileId) => (await t.send('GET', '/profile/stats?id=' + profileId)).body;
const activityCount = (t, profileId) => t.env.TAGS_DB.rows('SELECT COUNT(*) AS n FROM profile_activity WHERE profile_id = ?', profileId)[0].n;

test('sync records saved works once and only known works', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(1));
  const profileId = await t.makeProfile(code(1));
  const sync = syncer(t, code(1));
  // 999 는 Lookup.json 에 없다
  const res = await sync([123, 456, 999]);
  assert.deepEqual(Object.keys(res.body), ['ok', 'serverSyncVersion', 'updatedAt']);
  assert.equal((await statsOf(t, profileId)).saved, 2);
  await sync([123, 456, 999]);
  assert.equal((await statsOf(t, profileId)).saved, 2);
  assert.deepEqual(t.env.TAGS_DB.rows("SELECT item_key FROM profile_activity WHERE kind = 'save' ORDER BY item_key").map(r => r.item_key), ['novel:123', 'novel:456']);
}));

test('saved never decreases and re-adding does not count twice', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(1));
  const profileId = await t.makeProfile(code(1));
  const sync = syncer(t, code(1));
  await sync([123, 456]);
  assert.equal((await statsOf(t, profileId)).saved, 2);
  await sync([456]);
  assert.equal((await statsOf(t, profileId)).saved, 2);
  await sync([123, 456]);
  assert.equal((await statsOf(t, profileId)).saved, 2);
}));

test('sync without a profile records nothing', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(1));
  await syncer(t, code(1))([123, 456]);
  assert.equal(t.env.TAGS_DB.rows('SELECT * FROM profile_activity').length, 0);
}));

test('a bump after the profile counts; admin cancel removes it', withClock(async () => {
  const t = await setupDisplayAdmin();
  await signup(t, code(1));
  await signup(t, code(2));
  const p1 = await t.makeProfile(code(1));
  const p2 = await t.makeProfile(code(2));
  const bump = (c, id) => t.send('POST', '/bump/request', { personalCode: c, type: 'novel', id });
  const first = await bump(code(1), 123);
  assert.equal(first.status, 201);
  assert.deepEqual(Object.keys(first.body), ['ok', 'startAt', 'endAt']);
  assert.equal((await statsOf(t, p1)).bumped, 1);
  t.tick(60000);
  assert.equal((await bump(code(2), 456)).status, 201);
  assert.equal((await statsOf(t, p2)).bumped, 1);
  const list = (await t.api('GET', 'bumps')).body.items;
  // 대기 중인 끌올 취소
  const waiting = list.find(r => r.state === 'waiting');
  assert.equal((await t.api('POST', 'bumps/cancel', { id: waiting.id })).status, 200);
  assert.equal((await statsOf(t, p2)).bumped, 0);
  // 활성 끌올 취소
  const active = list.find(r => r.state === 'active');
  assert.equal((await t.api('POST', 'bumps/cancel', { id: active.id })).status, 200);
  assert.equal((await statsOf(t, p1)).bumped, 0);
}));

test('profile delete, account delete and admin account delete remove activity rows', withClock(async () => {
  const t = await setupDisplayAdmin();
  const prepare = async n => {
    await signup(t, code(n));
    const profileId = await t.makeProfile(code(n));
    await syncer(t, code(n))([123, 456]);
    assert.equal(activityCount(t, profileId), 2);
    return profileId;
  };
  const a = await prepare(1);
  assert.equal((await t.send('POST', '/profile/delete', { personalCode: code(1) })).status, 200);
  assert.equal(activityCount(t, a), 0);
  const b = await prepare(2);
  assert.equal((await t.send('POST', '/user/delete', { personalCode: code(2) })).status, 200);
  assert.equal(activityCount(t, b), 0);
  const c = await prepare(3);
  assert.equal((await t.api('POST', 'profiles/delete-account', { id: c })).status, 200);
  assert.equal(activityCount(t, c), 0);
  const d = await prepare(4);
  assert.equal((await t.api('POST', 'profiles/delete', { id: d })).status, 200);
  assert.equal(activityCount(t, d), 0);
}));

test('missing stats table never breaks sync, bump or profile delete', withClock(async () => {
  const t = await setupDisplayAdmin([...BASE_SCHEMAS, 'profile_schema.sql']);
  const prepare = async n => {
    await signup(t, code(n));
    return t.makeProfile(code(n));
  };
  await prepare(1);
  await syncer(t, code(1))([123, 456]);
  assert.equal((await t.send('POST', '/bump/request', { personalCode: code(1), type: 'novel', id: 123 })).status, 201);
  const cancelId = (await t.api('GET', 'bumps')).body.items[0].id;
  assert.equal((await t.api('POST', 'bumps/cancel', { id: cancelId })).status, 200);
  assert.deepEqual((await t.send('POST', '/profile/delete', { personalCode: code(1) })).body, { ok: true });
  await prepare(2);
  assert.deepEqual((await t.send('POST', '/user/delete', { personalCode: code(2) })).body, { ok: true });
  const c = await prepare(3);
  assert.equal((await t.api('POST', 'profiles/delete-account', { id: c })).status, 200);
  const d = await prepare(4);
  assert.equal((await t.api('POST', 'profiles/delete', { id: d })).status, 200);
}));

// ---- Task 3 리뷰 1차: 동기화가 무거운 Lookup.json 을 필요할 때만 읽는다 ----
function countLookup(t) {
  const counter = { n: 0 };
  const real = t.env.ASSETS.fetch;
  t.env.ASSETS.fetch = req => {
    if (decodeURIComponent(new URL(req.url).pathname).endsWith('Lookup.json')) counter.n++;
    return real(req);
  };
  return counter;
}

test('sync reads Lookup only for new works, and caches it for 10 minutes', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(1));
  const profileId = await t.makeProfile(code(1));
  const sync = syncer(t, code(1));
  const lookups = countLookup(t);
  await sync([123, 456]);
  assert.equal(lookups.n, 1);
  // 새로 담은 작품이 없으면 Lookup 을 읽지 않는다(캐시가 끝난 뒤에도)
  await sync([123, 456]);
  t.tick(11 * 60000);
  await sync([123, 456]);
  assert.equal(lookups.n, 1);
  // 새 작품이 있고 캐시가 끝났으면 다시 읽는다
  await sync([123, 456, 789]);
  assert.equal(lookups.n, 2);
  // 캐시 안에서는 새 작품(Lookup 에 없는 999 포함)이 있어도 다시 받지 않는다
  t.tick(60000);
  await sync([123, 456, 789, 999]);
  assert.equal(lookups.n, 2);
  assert.equal((await statsOf(t, profileId)).saved, 3);
}));

test('sync without a profile never reads Lookup', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(1));
  const lookups = countLookup(t);
  const sync = syncer(t, code(1));
  await sync([123, 456]);
  await sync([123, 456, 789]);
  assert.equal(lookups.n, 0);
}));

test('a failed activity delete leaves the profile so a retry finishes', withClock(async () => {
  const t = await setupDisplayAdmin();
  const db = t.env.TAGS_DB.db;
  const block = () => db.exec("CREATE TRIGGER block_activity BEFORE DELETE ON profile_activity BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  const unblock = () => db.exec('DROP TRIGGER block_activity');
  const prepare = async n => {
    await signup(t, code(n));
    const profileId = await t.makeProfile(code(n));
    await syncer(t, code(n))([123]);
    return profileId;
  };
  const profileRow = id => t.env.TAGS_DB.rows('SELECT 1 FROM profiles WHERE profile_id = ?', id).length;
  // /profile/delete
  const a = await prepare(1);
  block();
  assert.equal((await t.send('POST', '/profile/delete', { personalCode: code(1) })).status, 503);
  assert.equal(profileRow(a), 1);
  unblock();
  assert.equal((await t.send('POST', '/profile/delete', { personalCode: code(1) })).status, 200);
  assert.equal(activityCount(t, a), 0);
  // /user/delete (deleteProfileRows)
  const b = await prepare(2);
  block();
  assert.equal((await t.send('POST', '/user/delete', { personalCode: code(2) })).status, 503);
  assert.equal(profileRow(b), 1);
  unblock();
  assert.equal((await t.send('POST', '/user/delete', { personalCode: code(2) })).status, 200);
  assert.equal(profileRow(b), 0);
  assert.equal(activityCount(t, b), 0);
  // 관리자 끌올 취소
  await signup(t, code(3));
  await t.makeProfile(code(3));
  assert.equal((await t.send('POST', '/bump/request', { personalCode: code(3), type: 'novel', id: 123 })).status, 201);
  const bumpId = (await t.api('GET', 'bumps')).body.items[0].id;
  block();
  assert.notEqual((await t.api('POST', 'bumps/cancel', { id: bumpId })).status, 200);
  assert.equal(t.env.TAGS_DB.rows('SELECT * FROM bump_cancels').length, 0);
  unblock();
  assert.equal((await t.api('POST', 'bumps/cancel', { id: bumpId })).status, 200);
  assert.equal(t.env.TAGS_DB.rows("SELECT * FROM profile_activity WHERE kind = 'bump'").length, 0);
}));

// ---- 최종 리뷰 수정 ----
test('/profile/view reads Lookup only for profiled callers, and caches it', withClock(async () => {
  const { t } = await setup();
  await t.account(code(5));
  const lookups = countLookup(t);
  await t.send('POST', '/profile/view', { personalCode: code(5), type: 'novel', id: 123 });
  await t.send('POST', '/profile/view', { personalCode: code(5), type: 'novel', id: 456 });
  assert.equal(lookups.n, 0);
  assert.deepEqual((await t.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id: 123 })).body, { ok: true, counted: true });
  assert.deepEqual((await t.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id: 456 })).body, { ok: true, counted: true });
  assert.ok(lookups.n <= 1, 'two views inside the cache window read Lookup at most once');
}));

test('/bump/request still reads Lookup itself (fail-closed, no cache)', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(1));
  await t.makeProfile(code(1));
  const lookups = countLookup(t);
  await t.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id: 123 });
  assert.equal(lookups.n, 1);
  assert.equal((await t.send('POST', '/bump/request', { personalCode: code(1), type: 'novel', id: 123 })).status, 201);
  assert.equal(lookups.n, 2);
}));

test('/profile/view says capped only when the daily cap refused it', withClock(async () => {
  const { t, env, profileId } = await setup();
  const now = Date.now();
  const insert = env.TAGS_DB.db.prepare("INSERT INTO profile_activity (profile_id, kind, item_key, at) VALUES (?, 'view', ?, ?)");
  for (let i = 0; i < 199; i++) insert.run(profileId, 'novel:' + (10000 + i), now);
  const view = id => t.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id });
  assert.deepEqual((await view(123)).body, { ok: true, counted: true });
  // 이미 센 작품은 capped 가 아니다
  assert.deepEqual((await view(123)).body, { ok: true, counted: false });
  // 한도(200)가 찼으므로 새 작품은 capped
  assert.deepEqual((await view(456)).body, { ok: true, counted: false, capped: true });
  // 다음 날에는 다시 센다
  t.tick(DAY);
  assert.deepEqual((await view(456)).body, { ok: true, counted: true });
}));

test('/profile/view rate-limits on its own key, apart from tag votes', withClock(async () => {
  const { t, env } = await setup();
  const seen = [];
  env.RL_TAG_WRITE = { limit: async ({ key }) => { seen.push(key); return { success: true }; } };
  await t.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id: 123 });
  await t.vote(code(1), 123, '일상');
  assert.equal(seen[0], 'view:192.0.2.1');
  assert.equal(seen[1], '192.0.2.1');
}));

test('daily-cap index exists and is used by the cap COUNT', () => {
  const d1 = new D1([...BASE_SCHEMAS, 'profile_schema.sql', 'stats_schema.sql']);
  const idx = d1.rows("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_profile_activity_day'");
  assert.equal(idx.length, 1);
  const plan = d1.rows("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM profile_activity WHERE profile_id = 'x' AND kind = 'view' AND at >= 1");
  assert.ok(plan.some(r => /idx_profile_activity_day/.test(r.detail)), JSON.stringify(plan));
});

// 메모리 Map 으로 caches.default 를 흉내 낸다.
function fakeCaches() {
  const store = new Map();
  const counter = { match: 0, put: 0 };
  return {
    counter, store,
    default: {
      match: async req => { counter.match++; const r = store.get(req.url); return r ? r.clone() : undefined; },
      put: async (req, res) => { counter.put++; store.set(req.url, res.clone()); }
    }
  };
}

test('GET /profile/stats is served from the edge cache inside 60s', withClock(async () => {
  const caches = fakeCaches();
  const t = await setupDisplay(undefined, { caches });
  await t.account(code(1));
  const profileId = await t.makeProfile(code(1));
  await t.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id: 123 });
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p) };
  const first = await t.send('GET', '/profile/stats?id=' + profileId, undefined, ctx);
  assert.equal(first.body.viewed, 1);
  assert.equal(waits.length, 1);
  await Promise.all(waits);
  assert.equal(caches.counter.put, 1);
  const cached = caches.store.get('https://example.test/profile/stats?id=' + profileId);
  assert.equal(cached.headers.get('Cache-Control'), 'public, max-age=60');
  // 캐시 안에서는 D1 을 읽지 않는다(새 기록이 있어도 60초 동안 같은 값). 다른 쿼리를 붙여도 같은 키다.
  await t.send('POST', '/profile/view', { personalCode: code(1), type: 'novel', id: 456 });
  const prepare = t.env.TAGS_DB.prepare.bind(t.env.TAGS_DB);
  let reads = 0;
  t.env.TAGS_DB.prepare = sql => { reads++; return prepare(sql); };
  const second = await t.send('GET', '/profile/stats?id=' + profileId + '&x=1');
  assert.equal(second.status, 200);
  assert.equal(second.body.viewed, 1);
  assert.equal(reads, 0);
  assert.equal(caches.counter.put, 1);
  // 400·404 는 캐시하지 않는다
  assert.equal((await t.send('GET', '/profile/stats?id=AAAAAAAAAAAA')).status, 404);
  assert.equal((await t.send('GET', '/profile/stats?id=short')).status, 400);
  assert.equal(caches.counter.put, 1);
}));

test('sync records saves through ctx.waitUntil when ctx is given', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(1));
  const profileId = await t.makeProfile(code(1));
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p) };
  const res = await t.send('PUT', '/user/sync', {
    personalCode: code(1), clientSyncVersion: 1,
    data: { version: 2, deletedBookmarks: [], bookmarks: [{ id: 'b1', name: '북마크', items: [{ type: 'novel', id: 123, addedAt: 1 }] }] }
  }, ctx);
  assert.equal(res.status, 200);
  assert.equal(waits.length, 1);
  await Promise.all(waits);
  assert.equal((await statsOf(t, profileId)).saved, 1);
}));

test('a stats failure is logged', withClock(async () => {
  const errors = [];
  const quiet = { ...console, error: (...a) => errors.push(a) };
  const t = await setupDisplay([...BASE_SCHEMAS, 'profile_schema.sql'], { console: quiet });
  await t.account(code(1));
  const id = await t.makeProfile(code(1));
  assert.equal((await t.send('GET', '/profile/stats?id=' + id)).status, 503);
  const logged = errors.filter(a => a[0] === 'stats unavailable');
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][1]), /no such table/);
}));
