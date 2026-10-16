// 아이디 로그인 API 테스트(Task 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, clock } = require('./helpers/workerHarness.cjs');
const { setupDisplay, withClock, code } = require('./helpers/profileSetup.cjs');

const DAY = 86400000;
const loadApi = async () => ({
  config: await load('worker/loginIdConfig.js'),
  api: await load('worker/loginIdApi.js')
});

test('normalizeLoginId trims, lowercases and rejects bad ids', async () => {
  const { config } = await loadApi();
  assert.equal(config.normalizeLoginId(' Kim_01 '), 'kim_01');
  for (const bad of ['abc', 'a'.repeat(21), '한글아이디', 'kim-01', 5, null]) {
    assert.equal(config.normalizeLoginId(bad), null, String(bad));
  }
  assert.equal(config.LOGIN_ID_COOLDOWN_MS, DAY);
  assert.equal(config.LOGIN_CODE_DEADLINE, Date.UTC(2026, 9, 31, 15, 0, 0));
});

test('login returns the code for an id', async () => {
  const { api } = await loadApi();
  const s = await setupDisplay();
  await s.account(code(1));
  assert.equal(await api.insertLoginId(s.env, 'kim_01', code(1), clock.now), 'ok');
  const ok = await s.send('POST', '/user/login', { loginId: 'KIM_01' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { personalCode: code(1), loginId: 'kim_01' });
  const missing = await s.send('POST', '/user/login', { loginId: 'nobody_1' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'login id not found');
  const bad = await s.send('POST', '/user/login', { loginId: 'ab' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid login id');
});

test('set converts a code-only account and frees the old id on change', async () => {
  const s = await setupDisplay();
  await s.account(code(1));
  const first = await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'first_id' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'second_id' });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal((await s.send('POST', '/user/login', { loginId: 'first_id' })).status, 404);
  assert.equal((await s.send('POST', '/user/login', { loginId: 'second_id' })).status, 200);
});

test('change within a day is 429 with retryAt, after a day works', withClock(async () => {
  const s = await setupDisplay();
  await s.account(code(1));
  await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'first_id' });
  const changedAt = clock.now;
  await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'second_id' });
  const blocked = await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'third_id' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, 'login id cooldown');
  assert.equal(blocked.body.retryAt, changedAt + DAY);
  // 같은 아이디 재설정은 쿨타임 중에도 200 이고 changed_at 은 그대로다.
  const same = await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'Second_ID' });
  assert.equal(same.status, 200);
  assert.equal(s.env.TAGS_DB.rows('SELECT changed_at FROM login_ids')[0].changed_at, changedAt);
  clock.now += DAY;
  const later = await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'third_id' });
  assert.equal(later.status, 200);
}));

test('taken id is 409', async () => {
  const { api } = await loadApi();
  const s = await setupDisplay();
  await s.account(code(1));
  await s.account(code(2));
  await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'mine_one' });
  const taken = await s.send('POST', '/login-id/set', { personalCode: code(2), loginId: 'MINE_one' });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, 'login id taken');
  assert.equal(await api.insertLoginId(s.env, 'mine_one', code(2), clock.now), 'taken');
  // 아이디가 있는 계정이 남의 아이디로 바꾸려 해도 기존 아이디는 그대로.
  await s.send('POST', '/login-id/set', { personalCode: code(2), loginId: 'other_one' });
  clock.now += DAY;
  const change = await s.send('POST', '/login-id/set', { personalCode: code(2), loginId: 'mine_one' });
  assert.equal(change.status, 409);
  assert.equal((await s.send('POST', '/user/login', { loginId: 'other_one' })).body.personalCode, code(2));
  assert.equal((await s.send('POST', '/user/login', { loginId: 'mine_one' })).body.personalCode, code(1));
  clock.now -= DAY;
});

test('set for a missing account is 404, set/me for a deleted account is 410', async () => {
  const s = await setupDisplay();
  const missing = await s.send('POST', '/login-id/set', { personalCode: code(9), loginId: 'ghost_id' });
  assert.equal(missing.status, 404);
  await s.account(code(1));
  const del = await s.send('POST', '/user/delete', { personalCode: code(1) });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  for (const path of ['/login-id/set', '/login-id/me']) {
    const res = await s.send('POST', path, { personalCode: code(1), loginId: 'gone_one' });
    assert.equal(res.status, 410, path);
    assert.equal(res.body.error, 'account deleted');
  }
});

test('me reports loginId and changeableAt', withClock(async () => {
  const s = await setupDisplay();
  await s.account(code(1));
  const none = await s.send('POST', '/login-id/me', { personalCode: code(1) });
  assert.deepEqual(none.body, { loginId: null, changeableAt: 0 });
  await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'first_id' });
  assert.deepEqual((await s.send('POST', '/login-id/me', { personalCode: code(1) })).body, { loginId: 'first_id', changeableAt: 0 });
  const changedAt = clock.now;
  await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'second_id' });
  assert.deepEqual((await s.send('POST', '/login-id/me', { personalCode: code(1) })).body, { loginId: 'second_id', changeableAt: changedAt + DAY });
}));

test('missing table is 503 login id unavailable', async () => {
  const s = await setupDisplay(['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql', 'profile_schema.sql']);
  await s.account(code(1));
  const res = await s.send('POST', '/login-id/me', { personalCode: code(1) });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'login id unavailable');
});

// ---- Task 2: 가입·조회·마감·계정 삭제 ----
const { hash } = require('./helpers/workerHarness.cjs');
const { setupDisplayAdmin } = require('./helpers/adminSetup.cjs');
const DEADLINE = Date.UTC(2026, 9, 31, 15, 0, 0);
const userKey = c => 'user/' + hash('user-v2:' + c) + '.json';

test('signup with an id creates account and id together', async () => {
  const s = await setupDisplay();
  const res = await s.send('POST', '/user/signup', { personalCode: code(1), loginId: ' New_User ' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.loginId, 'new_user');
  const login = await s.send('POST', '/user/login', { loginId: 'new_user' });
  assert.equal(login.status, 200);
  assert.equal(login.body.personalCode, code(1));
  const plain = await s.send('POST', '/user/signup', { personalCode: code(2) });
  assert.equal(plain.status, 201);
  assert.equal(plain.body.loginId, null);
});

test('signup with a taken id is 409 and creates no account', async () => {
  const s = await setupDisplay();
  assert.equal((await s.send('POST', '/user/signup', { personalCode: code(1), loginId: 'taken_id' })).status, 201);
  const res = await s.send('POST', '/user/signup', { personalCode: code(2), loginId: 'TAKEN_ID' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'login id taken');
  assert.ok(!s.env.FAVORITES_BUCKET.objects.has(userKey(code(2))));
  assert.equal(s.env.TAGS_DB.rows('SELECT * FROM login_ids').length, 1);
});

test('signup with an invalid id is 400', async () => {
  const s = await setupDisplay();
  const res = await s.send('POST', '/user/signup', { personalCode: code(1), loginId: 'a-b' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid login id');
  assert.ok(!s.env.FAVORITES_BUCKET.objects.has(userKey(code(1))));
});

test('signup for an existing account does not attach the id', async () => {
  const s = await setupDisplay();
  await s.account(code(1));
  const res = await s.send('POST', '/user/signup', { personalCode: code(1), loginId: 'late_id' });
  assert.equal(res.status, 200);
  assert.equal(res.body.existed, true);
  // 보낸 아이디가 아니라 서버에 실제로 걸린 아이디(없으면 null)를 돌려준다
  assert.equal(res.body.loginId, null);
  assert.equal(s.env.TAGS_DB.rows('SELECT * FROM login_ids').length, 0);
});

test('signup for an existing account returns the id it really has', async () => {
  const s = await setupDisplay();
  assert.equal((await s.send('POST', '/user/signup', { personalCode: code(1), loginId: 'real_id' })).status, 201);
  const again = await s.send('POST', '/user/signup', { personalCode: code(1), loginId: 'typed_id' });
  assert.equal(again.status, 200);
  assert.equal(again.body.existed, true);
  assert.equal(again.body.loginId, 'real_id');
});

test('after the deadline get does not rebuild a code-only account from its owner index', withClock(async () => {
  const s = await setupDisplay();
  const plain = code(1);
  const withId = code(2);
  assert.equal((await s.send('POST', '/user/signup', { personalCode: plain })).status, 201);
  assert.equal((await s.send('POST', '/user/signup', { personalCode: withId, loginId: 'keeps_id' })).status, 201);
  for (const c of [plain, withId]) {
    const lib = await s.send('POST', '/library', { personalCode: c, name: '서재', items: [{ type: 'novel', id: 123 }] });
    assert.equal(lib.status, 201, JSON.stringify(lib.body));
    // 정리의 users 단계가 본체만 지우고 owners 단계는 아직인 상태
    s.env.FAVORITES_BUCKET.objects.delete(userKey(c));
  }
  clock.now = DEADLINE;
  const gone = await s.send('POST', '/user/get', { personalCode: plain });
  assert.equal(gone.status, 404);
  assert.ok(!s.env.FAVORITES_BUCKET.objects.has(userKey(plain)), 'code-only body must not come back');
  // 아이디가 있는 계정은 마감 뒤에도 예전처럼 되살린다
  const kept = await s.send('POST', '/user/get', { personalCode: withId });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(kept.body.migrated, true);
  assert.equal(kept.body.loginId, 'keeps_id');
}));

test('after the deadline get does not rebuild when login_ids cannot be read; before the deadline it still does', withClock(async () => {
  const s = await setupDisplay(['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql', 'profile_schema.sql']);
  const c = code(1);
  assert.equal((await s.send('POST', '/user/signup', { personalCode: c })).status, 201);
  assert.equal((await s.send('POST', '/library', { personalCode: c, name: '서재', items: [{ type: 'novel', id: 123 }] })).status, 201);
  s.env.FAVORITES_BUCKET.objects.delete(userKey(c));
  clock.now = DEADLINE;
  assert.equal((await s.send('POST', '/user/get', { personalCode: c })).status, 404);
  assert.ok(!s.env.FAVORITES_BUCKET.objects.has(userKey(c)));
  clock.now = DEADLINE - 1;
  const before = await s.send('POST', '/user/get', { personalCode: c });
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.migrated, true);
}));

test('a first id after the deadline is 410; changing an existing id still works', withClock(async () => {
  const s = await setupDisplay();
  await s.account(code(1));
  await s.account(code(2));
  clock.now = DEADLINE - 1;
  assert.equal((await s.send('POST', '/login-id/set', { personalCode: code(2), loginId: 'early_id' })).status, 200);
  clock.now = DEADLINE;
  const late = await s.send('POST', '/login-id/set', { personalCode: code(1), loginId: 'late_id' });
  assert.equal(late.status, 410);
  assert.equal(late.body.error, 'account deleted');
  assert.equal(s.env.TAGS_DB.rows('SELECT * FROM login_ids WHERE personal_code = ?', code(1)).length, 0);
  const change = await s.send('POST', '/login-id/set', { personalCode: code(2), loginId: 'changed_id' });
  assert.equal(change.status, 200, JSON.stringify(change.body));
  assert.equal(change.body.loginId, 'changed_id');
}));

test('code-only signup works before the deadline and is 410 after', withClock(async () => {
  const s = await setupDisplay();
  clock.now = DEADLINE - 1;
  assert.equal((await s.send('POST', '/user/signup', { personalCode: code(1) })).status, 201);
  clock.now = DEADLINE;
  const late = await s.send('POST', '/user/signup', { personalCode: code(2) });
  assert.equal(late.status, 410);
  assert.equal(late.body.error, 'account deleted');
  assert.ok(!s.env.FAVORITES_BUCKET.objects.has(userKey(code(2))));
  const withId = await s.send('POST', '/user/signup', { personalCode: code(3), loginId: 'after_deadline' });
  assert.equal(withId.status, 201, JSON.stringify(withId.body));
}));

test('get returns loginId', async () => {
  const s = await setupDisplay();
  await s.send('POST', '/user/signup', { personalCode: code(1), loginId: 'get_user' });
  await s.send('POST', '/user/signup', { personalCode: code(2) });
  assert.equal((await s.send('POST', '/user/get', { personalCode: code(1) })).body.loginId, 'get_user');
  const plain = await s.send('POST', '/user/get', { personalCode: code(2) });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.loginId, null);
});

test('id signup is 503 when login_ids is unavailable, code-only keeps working', async () => {
  const s = await setupDisplay(['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql', 'profile_schema.sql']);
  const res = await s.send('POST', '/user/signup', { personalCode: code(1), loginId: 'no_table' });
  assert.equal(res.status, 503);
  assert.ok(!s.env.FAVORITES_BUCKET.objects.has(userKey(code(1))));
  assert.equal((await s.send('POST', '/user/signup', { personalCode: code(2) })).status, 201);
  const got = await s.send('POST', '/user/get', { personalCode: code(2) });
  assert.equal(got.status, 200);
  assert.equal(got.body.loginId, null);
  const sync = await s.send('PUT', '/user/sync', { personalCode: code(2), clientSyncVersion: 1, data: { version: 2, bookmarks: [], deletedBookmarks: [] } });
  assert.equal(sync.status, 200, JSON.stringify(sync.body));
});

test('user delete removes the login id', async () => {
  const s = await setupDisplay();
  await s.send('POST', '/user/signup', { personalCode: code(1), loginId: 'bye_user' });
  assert.equal((await s.send('POST', '/user/delete', { personalCode: code(1) })).status, 200);
  assert.equal((await s.send('POST', '/user/login', { loginId: 'bye_user' })).status, 404);
  assert.equal((await s.send('POST', '/user/signup', { personalCode: code(2), loginId: 'bye_user' })).status, 201);
});

test('admin delete-account fully purges an account that has an id', async () => {
  const t = await setupDisplayAdmin();
  const c = code(1);
  assert.equal((await t.send('POST', '/user/signup', { personalCode: c, loginId: 'admin_gone' })).status, 201);
  const profileId = await t.makeProfile(c);
  const res = await t.api('POST', 'profiles/delete-account', { id: profileId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has(userKey(c)));
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has('owners/' + hash('owner-index:' + c) + '.json'));
  assert.equal(t.env.TAGS_DB.rows('SELECT * FROM login_ids').length, 0);
  const marks = t.env.TAGS_DB.rows('SELECT * FROM deleted_accounts');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].pending, 0);
  assert.equal(marks[0].deleted_by, 'admin');
  const log = t.env.TAGS_DB.rows("SELECT * FROM admin_actions WHERE action = 'profile.delete-account'");
  assert.equal(log.length, 1);
});
