// 계정 삭제(POST /user/delete) 검증: 사용자 본인 삭제, 멱등, 부분 실패 재개, 남의 서재 보호.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, D1, Bucket, hash, allow, request, clock } = require('./helpers/workerHarness.cjs');
const { setupDisplay, withClock, code } = require('./helpers/profileSetup.cjs');
const { setupDisplayAdmin } = require('./helpers/adminSetup.cjs');

const player = n => 'player-' + String(n).padStart(4, '0') + '-abcdefghijkl';
const rows = (t, sql, ...args) => t.env.TAGS_DB.rows(sql, ...args);

async function signup(t, c) {
  const res = await t.send('POST', '/user/signup', { personalCode: c });
  assert.ok(res.status === 200 || res.status === 201, JSON.stringify(res.body));
}
async function play(t, playerId, scoreMs, extra) {
  const start = await t.send('POST', '/game/start', { playerId });
  clock.now += scoreMs + 2800;
  const end = await t.send('POST', '/game/end', { playerId, runToken: start.body.runToken, scoreMs });
  return t.send('POST', '/game/submit', { playerId, resultToken: end.body.resultToken, ...extra });
}
const userKey = c => 'user/' + hash('user-v2:' + c) + '.json';
const ownersKey = c => 'owners/' + hash('owner-index:' + c) + '.json';

test('user delete removes account, profile, libraries and profile ranking rows', withClock(async () => {
  const t = await setupDisplay();
  const c = code(1);
  await signup(t, c);
  const profileId = await t.makeProfile(c);
  const lib = await t.send('POST', '/library', { personalCode: c, name: '내 서재', items: [{ type: 'novel', id: 123 }] });
  assert.equal(lib.status, 201, JSON.stringify(lib.body));
  assert.equal((await play(t, player(1), 20000, { personalCode: c })).status, 200);
  t.tick();
  assert.equal((await t.vote(c, 123, '일상')).status, 200);
  assert.equal((await t.send('POST', '/bump/request', { personalCode: c, type: 'novel', id: 123 })).status, 201);
  // 공개 목록 색인이 있어야 색인 정리까지 확인할 수 있다
  assert.ok((await t.send('GET', '/library')).body.items.some(r => r.code === lib.body.code));

  const res = await t.send('POST', '/user/delete', { personalCode: c });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true });

  const objects = t.env.FAVORITES_BUCKET.objects;
  assert.ok(!objects.has(userKey(c)));
  assert.ok(!objects.has(ownersKey(c)));
  assert.ok(!objects.has('library/' + lib.body.code + '.json'));
  assert.ok(!(await t.send('GET', '/library')).body.items.some(r => r.code === lib.body.code));
  assert.equal(rows(t, 'SELECT * FROM profiles').length, 0);
  assert.equal(rows(t, 'SELECT * FROM profile_links').length, 0);
  assert.equal(rows(t, 'SELECT * FROM game_scores WHERE player_hash = ?', hash('spacegame-profile:' + profileId)).length, 0);
  assert.equal(rows(t, 'SELECT * FROM game_scores').length, 0);
  assert.equal(rows(t, 'SELECT * FROM tag_votes').length, 1);
  assert.equal(rows(t, 'SELECT * FROM bumps').length, 1);
  assert.deepEqual((await t.voters(123, '일상')).body, { profileIds: [], anonymous: 1 });
  const marks = rows(t, 'SELECT * FROM deleted_accounts');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].owner_hash, hash('profile:' + c));
  assert.equal(marks[0].deleted_by, 'self');
  assert.equal(marks[0].pending, 0);
}));

test('user delete without profile works', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(2));
  const res = await t.send('POST', '/user/delete', { personalCode: code(2) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has(userKey(code(2))));
  assert.equal(rows(t, 'SELECT pending FROM deleted_accounts')[0].pending, 0);
}));

test('user delete is idempotent', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(3));
  assert.equal((await t.send('POST', '/user/delete', { personalCode: code(3) })).status, 200);
  const again = await t.send('POST', '/user/delete', { personalCode: code(3) });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { ok: true });
}));

test('user delete resumes after a partial failure', withClock(async () => {
  const t = await setupDisplay();
  const c = code(4);
  await signup(t, c);
  await t.makeProfile(c);
  const lib = await t.send('POST', '/library', { personalCode: c, name: '서재', items: [{ type: 'novel', id: 123 }] });
  assert.equal((await play(t, player(4), 20000, { personalCode: c })).status, 200);

  const db = t.env.TAGS_DB;
  const realBatch = db.batch.bind(db);
  let failures = 1;
  db.batch = async statements => {
    if (failures-- > 0) throw new Error('simulated D1 failure');
    return realBatch(statements);
  };
  const first = await t.send('POST', '/user/delete', { personalCode: c });
  assert.equal(first.status, 503);
  assert.equal(first.body.error, 'account delete unavailable');
  assert.equal(rows(t, 'SELECT pending FROM deleted_accounts')[0].pending, 1);
  assert.ok(t.env.FAVORITES_BUCKET.objects.has(userKey(c)), 'account body survives until the profile step finishes');

  db.batch = realBatch;
  const second = await t.send('POST', '/user/delete', { personalCode: c });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has(userKey(c)));
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has('library/' + lib.body.code + '.json'));
  assert.equal(rows(t, 'SELECT * FROM profiles').length, 0);
  assert.equal(rows(t, 'SELECT * FROM profile_links').length, 0);
  assert.equal(rows(t, 'SELECT * FROM game_scores').length, 0);
  assert.equal(rows(t, 'SELECT pending FROM deleted_accounts')[0].pending, 0);
}));

test('user delete keeps libraries it cannot prove ownership of', withClock(async () => {
  const t = await setupDisplay();
  await signup(t, code(5)); await signup(t, code(6));
  const mine = (await t.send('POST', '/library', { personalCode: code(5), name: '내 것', items: [] })).body;
  const theirs = (await t.send('POST', '/library', { personalCode: code(6), name: '남의 것', items: [] })).body;
  // 소유 색인에 남의 서재 코드를 직접 끼워 넣는다
  await t.env.FAVORITES_BUCKET.put(ownersKey(code(5)), JSON.stringify({ v: 1, codes: [mine.code, theirs.code] }));
  assert.equal((await t.send('POST', '/user/delete', { personalCode: code(5) })).status, 200);
  const objects = t.env.FAVORITES_BUCKET.objects;
  assert.ok(!objects.has('library/' + mine.code + '.json'));
  assert.ok(objects.has('library/' + theirs.code + '.json'));
  assert.ok((await t.send('GET', '/library')).body.items.some(r => r.code === theirs.code));
}));

test('user delete of unknown code is 404', withClock(async () => {
  const t = await setupDisplay();
  const res = await t.send('POST', '/user/delete', { personalCode: code(7) });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'account not found');
  assert.equal(rows(t, 'SELECT * FROM deleted_accounts').length, 0);
}));

test('user delete without deleted_accounts table is 503 and deletes nothing', withClock(async () => {
  const t = await setupDisplay(['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql']);
  const c = code(8);
  await signup(t, c);
  const lib = await t.send('POST', '/library', { personalCode: c, name: '서재', items: [] });
  const res = await t.send('POST', '/user/delete', { personalCode: c });
  assert.equal(res.status, 503);
  assert.ok(t.env.FAVORITES_BUCKET.objects.has(userKey(c)));
  assert.ok(t.env.FAVORITES_BUCKET.objects.has(ownersKey(c)));
  assert.ok(t.env.FAVORITES_BUCKET.objects.has('library/' + lib.body.code + '.json'));
}));

test('user delete cleans index entries of libraries whose R2 object is already gone', withClock(async () => {
  const t = await setupDisplay();
  const c = code(9);
  await signup(t, c);
  const lib = (await t.send('POST', '/library', { personalCode: c, name: '반쯤 지워짐', items: [] })).body;
  // 목록 색인은 첫 조회 때 만들어지므로 원본을 지우기 전에 한 번 조회한다
  assert.ok((await t.send('GET', '/library')).body.items.some(r => r.code === lib.code));
  // 이전 시도가 R2 원본만 지우고 실패한 상태
  await t.env.FAVORITES_BUCKET.delete('library/' + lib.code + '.json');
  assert.ok((await t.send('GET', '/library')).body.items.some(r => r.code === lib.code));
  assert.equal((await t.send('POST', '/user/delete', { personalCode: c })).status, 200);
  assert.ok(!(await t.send('GET', '/library')).body.items.some(r => r.code === lib.code));
}));

test('deleted code is rejected everywhere', withClock(async () => {
  const t = await setupDisplay();
  const c = code(10);
  await signup(t, c);
  assert.equal((await t.send('POST', '/user/delete', { personalCode: c })).status, 200);

  const gone = res => {
    assert.equal(res.status, 410, JSON.stringify(res.body));
    assert.equal(res.body.error, 'account deleted');
  };
  gone(await t.send('POST', '/user/signup', { personalCode: c }));
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has(userKey(c)), 'signup must not recreate the account');
  gone(await t.send('POST', '/user/get', { personalCode: c }));
  gone(await t.send('PUT', '/user/sync', { personalCode: c, clientSyncVersion: 1, data: { version: 2, bookmarks: [], deletedBookmarks: [] } }));
  gone(await t.send('POST', '/profile/me', { personalCode: c }));
  gone(await t.send('POST', '/profile/save', { personalCode: c, nickname: 'zz', icon: 'fushi-nyam', color: 'rose', bio: '' }));
  gone(await t.send('POST', '/library', { personalCode: c, name: '서재', items: [] }));
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has(userKey(c)));
}));

test('deleted code is rejected on library update and claim with personalCode only', withClock(async () => {
  const t = await setupDisplay();
  const c = code(11);
  await signup(t, c);
  const lib = (await t.send('POST', '/library', { personalCode: c, name: '서재', items: [] })).body;
  assert.equal((await t.send('POST', '/user/delete', { personalCode: c })).status, 200);
  // 서재는 지워졌으므로 다른 사람의 서재(편집 토큰 보유)를 만든다
  await signup(t, code(12));
  const other = (await t.send('POST', '/library', { personalCode: code(12), name: '남', items: [] })).body;
  const upd = await t.send('PUT', '/library/' + other.code, { editToken: other.editToken, personalCode: c, name: '바꿈' });
  assert.equal(upd.status, 410, JSON.stringify(upd.body));
  assert.equal(upd.body.error, 'account deleted');
  const claim = await t.send('POST', '/library/' + other.code + '/claim-owner', { editToken: other.editToken, personalCode: c });
  assert.equal(claim.status, 410, JSON.stringify(claim.body));
  assert.equal(claim.body.error, 'account deleted');
  // editToken 만으로는 검사하지 않는다
  const ok = await t.send('PUT', '/library/' + other.code, { editToken: other.editToken, name: '바꿈' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(lib.code);
}));

test('deleted code can still vote anonymously', withClock(async () => {
  const t = await setupDisplay();
  const c = code(13);
  await signup(t, c);
  assert.equal((await t.send('POST', '/user/delete', { personalCode: c })).status, 200);
  const res = await t.vote(c, 123, '일상');
  assert.notEqual(res.status, 410, JSON.stringify(res.body));
}));

test('guards are skipped when the table is missing', withClock(async () => {
  const t = await setupDisplay(['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql']);
  const c = code(14);
  assert.equal((await t.send('POST', '/user/signup', { personalCode: c })).status, 201);
  assert.equal((await t.send('POST', '/user/get', { personalCode: c })).status, 200);
  const sync = await t.send('PUT', '/user/sync', { personalCode: c, clientSyncVersion: 1, data: { version: 2, bookmarks: [], deletedBookmarks: [] } });
  assert.equal(sync.status, 200, JSON.stringify(sync.body));
}));

// ---- 관리자 계정 삭제 ----
async function adminDeleteSetup(c) {
  const t = await setupDisplayAdmin();
  await signup(t, c);
  const profileId = await t.makeProfile(c);
  const lib = await t.send('POST', '/library', { personalCode: c, name: '관리자 삭제 서재', items: [{ type: 'novel', id: 123 }] });
  assert.equal(lib.status, 201, JSON.stringify(lib.body));
  assert.equal((await play(t, player(20), 20000, { personalCode: c })).status, 200);
  assert.ok((await t.send('GET', '/library')).body.items.some(r => r.code === lib.body.code));
  return { t, profileId, libCode: lib.body.code };
}

test('admin delete-account removes profile-reachable data and leaves a pending mark', withClock(async () => {
  const c = code(20);
  const { t, profileId, libCode } = await adminDeleteSetup(c);
  const res = await t.api('POST', 'profiles/delete-account', { id: profileId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true });

  assert.equal(rows(t, 'SELECT * FROM profiles').length, 0);
  assert.equal(rows(t, 'SELECT * FROM profile_links').length, 0);
  assert.equal(rows(t, 'SELECT * FROM game_scores').length, 0);
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has('library/' + libCode + '.json'));
  assert.ok(!(await t.send('GET', '/library')).body.items.some(r => r.code === libCode));
  assert.ok(t.env.FAVORITES_BUCKET.objects.has(userKey(c)), 'account body survives until the next request');
  const marks = rows(t, 'SELECT * FROM deleted_accounts');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].deleted_by, 'admin');
  assert.equal(marks[0].pending, 1);
  const logs = rows(t, "SELECT * FROM admin_actions WHERE action = 'profile.delete-account'");
  assert.equal(logs.length, 1);
  const detail = JSON.parse(logs[0].detail);
  assert.equal(detail.before.profile_id, profileId);
  assert.ok(detail.link);
  assert.deepEqual(detail.libraryCodes, [libCode]);
}));

test('next request from an admin-deleted code finishes the purge', withClock(async () => {
  const c = code(21);
  const { t, profileId } = await adminDeleteSetup(c);
  assert.equal((await t.api('POST', 'profiles/delete-account', { id: profileId })).status, 200);
  const res = await t.send('POST', '/user/get', { personalCode: c });
  assert.equal(res.status, 410, JSON.stringify(res.body));
  assert.equal(res.body.error, 'account deleted');
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has(userKey(c)));
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has(ownersKey(c)));
  const marks = rows(t, 'SELECT * FROM deleted_accounts');
  assert.equal(marks[0].pending, 0);
  assert.equal(marks[0].deleted_by, 'admin');
}));

test('delete-account of unknown id is 404', withClock(async () => {
  const t = await setupDisplayAdmin();
  const res = await t.api('POST', 'profiles/delete-account', { id: 'AAAAAAAAAAAA' });
  assert.equal(res.status, 404);
  assert.equal(rows(t, 'SELECT * FROM deleted_accounts').length, 0);
}));

test('delete-account without the marker table is 503', withClock(async () => {
  const c = code(22);
  const { t, profileId } = await adminDeleteSetup(c);
  t.env.TAGS_DB.db.exec('DROP TABLE deleted_accounts');
  const res = await t.api('POST', 'profiles/delete-account', { id: profileId });
  assert.equal(res.status, 503, JSON.stringify(res.body));
  assert.equal(res.body.error, 'account delete unavailable');
  assert.equal(rows(t, 'SELECT * FROM profiles').length, 1);
}));

// ---- 최종 리뷰 반영 ----
test('claim-owner moves profileId so deleting the original owner keeps the claimed library', withClock(async () => {
  const a = code(30), b = code(31);
  const { t, profileId, libCode } = await adminDeleteSetup(a);
  // 편집 토큰은 게시 응답에만 있어 새로 게시한다
  const pub = (await t.send('POST', '/library', { personalCode: a, name: '넘길 서재', items: [] })).body;
  await signup(t, b);
  const claim = await t.send('POST', '/library/' + pub.code + '/claim-owner', { editToken: pub.editToken, personalCode: b });
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  const entry = () => t.send('GET', '/library').then(r => r.body.items.find(i => i.code === pub.code));
  assert.notEqual((await entry()).profileId, profileId, 'index no longer names the original owner');
  assert.equal((await t.api('POST', 'profiles/delete-account', { id: profileId })).status, 200);
  assert.ok(t.env.FAVORITES_BUCKET.objects.has('library/' + pub.code + '.json'), 'claimed library survives');
  assert.ok(!t.env.FAVORITES_BUCKET.objects.has('library/' + libCode + '.json'), 'own library is deleted');
}));

test('admin delete-account keeps the profile when the library index is unavailable', withClock(async () => {
  const c = code(32);
  const { t, profileId } = await adminDeleteSetup(c);
  const bucket = t.env.FAVORITES_BUCKET;
  await bucket.delete('indexes/library-v1.json');
  const realPut = bucket.put.bind(bucket);
  bucket.put = async (key, ...rest) => key === 'indexes/library-v1.json' ? null : realPut(key, ...rest);
  const res = await t.api('POST', 'profiles/delete-account', { id: profileId });
  assert.equal(res.status, 503, JSON.stringify(res.body));
  assert.equal(rows(t, 'SELECT * FROM profiles').length, 1, 'profile row kept so the admin can retry');
}));

test('admin delete-account keeps the profile when library deletion fails, and a retry works', withClock(async () => {
  const c = code(33);
  const { t, profileId, libCode } = await adminDeleteSetup(c);
  const bucket = t.env.FAVORITES_BUCKET;
  const realDelete = bucket.delete.bind(bucket);
  bucket.delete = async key => { if (key === 'library/' + libCode + '.json') throw new Error('simulated R2 failure'); return realDelete(key); };
  assert.equal((await t.api('POST', 'profiles/delete-account', { id: profileId })).status, 503);
  assert.equal(rows(t, 'SELECT * FROM profiles').length, 1);
  bucket.delete = realDelete;
  assert.equal((await t.api('POST', 'profiles/delete-account', { id: profileId })).status, 200);
  assert.equal(rows(t, 'SELECT * FROM profiles').length, 0);
  assert.ok(!bucket.objects.has('library/' + libCode + '.json'));
  assert.equal(rows(t, "SELECT * FROM admin_actions WHERE action = 'profile.delete-account'").length, 1);
}));

test('a marker hit purges leftovers written after the purge finished', withClock(async () => {
  const t = await setupDisplay();
  const c = code(34);
  await signup(t, c);
  const lib = (await t.send('POST', '/library', { personalCode: c, name: '늦은 쓰기', items: [] })).body;
  const bucket = t.env.FAVORITES_BUCKET;
  const saved = await bucket.objects.get('library/' + lib.code + '.json');
  const savedOwners = await bucket.objects.get(ownersKey(c));
  assert.equal((await t.send('POST', '/user/delete', { personalCode: c })).status, 200);
  assert.equal(rows(t, 'SELECT pending FROM deleted_accounts')[0].pending, 0);
  // 삭제 직전에 가드를 통과한 요청이 뒤늦게 쓴 것을 흉내 낸다
  bucket.objects.set('library/' + lib.code + '.json', saved);
  bucket.objects.set(ownersKey(c), savedOwners);
  bucket.objects.set(userKey(c), saved);
  const res = await t.send('POST', '/user/get', { personalCode: c });
  assert.equal(res.status, 410);
  assert.deepEqual(res.body, { error: 'account deleted' });
  assert.ok(!bucket.objects.has('library/' + lib.code + '.json'));
  assert.ok(!bucket.objects.has(ownersKey(c)));
  assert.ok(!bucket.objects.has(userKey(c)));
  const marks = rows(t, 'SELECT * FROM deleted_accounts');
  assert.equal(marks[0].pending, 0);
  assert.equal(marks[0].deleted_by, 'self');
}));

test('503 paths log the swallowed error', withClock(async () => {
  const t = await setupDisplay(['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql']);
  const c = code(35);
  await signup(t, c);
  const logged = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    assert.equal((await t.send('POST', '/user/delete', { personalCode: c })).status, 503);
  } finally { console.error = realError; }
  assert.ok(logged.some(l => l.startsWith('account delete failed')), JSON.stringify(logged));
}));
