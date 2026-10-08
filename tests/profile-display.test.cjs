// 유저 프로필 2단계(표시 연결) 검증: 태그 투표자, 끌올 신청자, 공개 북마크, 게임 랭킹.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, D1, Bucket, hash, allow, request, clock, root } = require('./helpers/workerHarness.cjs');

const ICONS = JSON.parse(fs.readFileSync(path.join(root, 'src/data/config/ProfileIcons.json'), 'utf8'));
const BASE_SCHEMAS = ['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql'];
const ALL_SCHEMAS = [...BASE_SCHEMAS, 'profile_schema.sql'];
const code = n => 'display_code_' + String(n).padStart(6, '0');

async function setupDisplay(schemas = ALL_SCHEMAS) {
  const backend = (await load('worker/favoritesShareWorker.js')).default;
  const env = {
    TAGS_DB: new D1(schemas), FAVORITES_BUCKET: new Bucket(),
    RL_USER_AUTH: allow, RL_USER_SYNC: allow, RL_LIB_LIST: allow, RL_LIB_WRITE: allow,
    RL_TAG_WRITE: allow, RL_BUMP_WRITE: allow, RL_GAME: allow, RL_GAME_SUBMIT: allow,
    RL_OWNER_LOOKUP: allow, GAME_TOKEN_SECRET: 'game-secret',
    ASSETS: { fetch: async req => {
      const p = decodeURIComponent(new URL(req.url).pathname);
      if (p.endsWith('ProfileIcons.json')) return Response.json(ICONS);
      if (p.endsWith('UserTagCatalog.json')) return Response.json(['일상', '로맨스', '피폐']);
      if (p.endsWith('Lookup.json')) return Response.json({ novel: { 123: {}, 456: {}, 789: {} } });
      return Response.json([{ posts: [{ id: 123 }, { id: 456 }, { id: 789 }] }]);
    } }
  };
  const send = async (method, url, body) => {
    const res = await backend.fetch(request(method, url, body), env);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const account = c => env.FAVORITES_BUCKET.put('user/' + hash('user-v2:' + c) + '.json', '{}');
  const makeProfile = async (c, nickname) => {
    const res = await send('POST', '/profile/save', { personalCode: c, nickname: nickname || 'u' + c.slice(-6), icon: 'fushi-nyam', color: 'rose', bio: '' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.profile.id;
  };
  const vote = (c, postId, tagName) => send('POST', '/tags/vote', { personalCode: c, postId, tagName });
  const voters = (postId, tagName) => send('POST', '/tags/voters', { postId, tagName });
  const tick = (ms = 1000) => { clock.now += ms; };
  return { env, send, account, makeProfile, vote, voters, tick };
}

// clock 은 모든 테스트가 공유하므로 각 테스트가 옮긴 만큼 되돌린다.
function withClock(fn) {
  return async () => {
    const saved = clock.now;
    try { await fn(); } finally { clock.now = saved; }
  };
}

// ---- 태그 투표자 ----
test('voters lists profiles only for votes after the profile existed', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1)); await t.account(code(2));
  assert.equal((await t.vote(code(1), 123, '일상')).status, 200);
  t.tick();
  await t.makeProfile(code(1));
  const idB = await t.makeProfile(code(2));
  t.tick();
  assert.equal((await t.vote(code(2), 456, '일상')).status, 200);
  assert.deepEqual((await t.voters(123, '일상')).body, { profileIds: [], anonymous: 1 });
  assert.deepEqual((await t.voters(456, '일상')).body, { profileIds: [idB], anonymous: 0 });
}));

test('recreated profiles do not claim older votes', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  await t.makeProfile(code(1), '처음');
  t.tick();
  await t.vote(code(1), 123, '일상');
  t.tick();
  await t.send('POST', '/profile/delete', { personalCode: code(1) });
  t.tick();
  await t.makeProfile(code(1), '다시');
  assert.deepEqual((await t.voters(123, '일상')).body, { profileIds: [], anonymous: 1 });
}));

test('voters survive a tag rename', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  const id = await t.makeProfile(code(1));
  t.tick();
  await t.vote(code(1), 123, '일상');
  // 관리 페이지의 태그 이름 바꾸기(adminTagDefs.js)와 같은 UPDATE
  t.env.TAGS_DB.db.exec("UPDATE OR IGNORE tag_votes SET tag_name = '로맨스' WHERE tag_name = '일상'");
  assert.deepEqual((await t.voters(123, '로맨스')).body, { profileIds: [id], anonymous: 0 });
}));

test('voters caps profile ids at fifty', withClock(async () => {
  const t = await setupDisplay();
  for (let i = 0; i < 55; i++) {
    await t.account(code(i));
    await t.makeProfile(code(i));
  }
  t.tick();
  for (let i = 0; i < 55; i++) {
    t.tick(10);
    assert.equal((await t.vote(code(i), 123, '피폐')).status, 200);
  }
  const res = (await t.voters(123, '피폐')).body;
  assert.equal(res.profileIds.length, 50);
  assert.equal(res.anonymous, 5);
}));

test('voters works without link tables', withClock(async () => {
  const t = await setupDisplay(BASE_SCHEMAS);
  await t.account(code(1));
  await t.vote(code(1), 123, '일상');
  const res = await t.voters(123, '일상');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { profileIds: [], anonymous: 1 });
  assert.equal((await t.voters('x', '일상')).status, 400);
}));

// ---- 끌올 ----
test('bump get reports the requester profile', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  const id = await t.makeProfile(code(1));
  t.tick();
  assert.equal((await t.send('POST', '/bump/request', { personalCode: code(1), type: 'novel', id: 123 })).status, 201);
  const got = await t.send('POST', '/bump/get', {});
  assert.equal(got.body.active.requesterProfileId, id);
}));

test('bumps before the profile stay anonymous', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  await t.send('POST', '/bump/request', { personalCode: code(1), type: 'novel', id: 123 });
  t.tick();
  await t.makeProfile(code(1));
  assert.equal((await t.send('POST', '/bump/get', {})).body.active.requesterProfileId, null);
}));

test('bump get works without link tables', withClock(async () => {
  const t = await setupDisplay(BASE_SCHEMAS);
  await t.account(code(1));
  await t.send('POST', '/bump/request', { personalCode: code(1), type: 'novel', id: 123 });
  const got = await t.send('POST', '/bump/get', {});
  assert.equal(got.status, 200);
  assert.equal(got.body.active.requesterProfileId, null);
}));

// ---- 공개 북마크 ----
const publish = (t, personalCode, name = '내 서재') =>
  t.send('POST', '/library', { personalCode, name, items: [{ type: 'novel', id: 123 }] });
const listRow = async (t, libCode) => (await t.send('GET', '/library')).body.items.find(r => r.code === libCode);

test('publishing with a profile stores profileId', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1)); await t.account(code(2));
  const id = await t.makeProfile(code(1));
  const mine = await publish(t, code(1));
  assert.equal(mine.status, 201);
  assert.equal((await t.send('GET', '/library/' + mine.body.code)).body.profileId, id);
  assert.equal((await listRow(t, mine.body.code)).profileId, id);
  const plain = await publish(t, code(2), '프로필 없음');
  assert.equal((await t.send('GET', '/library/' + plain.body.code)).body.profileId, null);
  const anonymous = await t.send('POST', '/library', { name: '익명', items: [] });
  assert.equal((await listRow(t, anonymous.body.code)).profileId, null);
}));

test('owner edits refresh profileId but strangers cannot', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1)); await t.account(code(2));
  const lib = (await publish(t, code(1))).body;
  const id = await t.makeProfile(code(1));
  await t.makeProfile(code(2));
  const edited = await t.send('PUT', '/library/' + lib.code, { editToken: lib.editToken, personalCode: code(1), name: '고침' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.profileId, id);
  const stranger = await t.send('PUT', '/library/' + lib.code, { editToken: lib.editToken, personalCode: code(2), name: '남이 고침' });
  assert.equal(stranger.status, 200);
  assert.equal(stranger.body.profileId, id, 'a stranger with the edit token cannot swap the profile');
  assert.equal((await listRow(t, lib.code)).profileId, id);
  // 주인이 프로필을 지운 뒤 다시 고치면 프로필이 빠진다
  await t.send('POST', '/profile/delete', { personalCode: code(1) });
  const cleared = await t.send('PUT', '/library/' + lib.code, { editToken: lib.editToken, personalCode: code(1), name: '다시' });
  assert.equal(cleared.body.profileId, null);
}));

test('index rebuild keeps profileId', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  const id = await t.makeProfile(code(1));
  const lib = (await publish(t, code(1))).body;
  const { refreshLibraryIndex } = await load('worker/libraryIndex.js');
  await t.env.FAVORITES_BUCKET.delete('library-index.json');
  for (const key of [...t.env.FAVORITES_BUCKET.objects.keys()].filter(k => k.includes('index'))) await t.env.FAVORITES_BUCKET.delete(key);
  await refreshLibraryIndex(t.env);
  assert.equal((await listRow(t, lib.code)).profileId, id);
}));

// ---- 게임 랭킹 ----
const player = n => 'player-' + String(n).padStart(4, '0') + '-abcdefghijkl';
async function play(t, playerId, scoreMs, extra) {
  const start = await t.send('POST', '/game/start', { playerId });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  clock.now += scoreMs + 2800;
  const end = await t.send('POST', '/game/end', { playerId, runToken: start.body.runToken, scoreMs });
  assert.equal(end.status, 200, JSON.stringify(end.body));
  return t.send('POST', '/game/submit', { playerId, resultToken: end.body.resultToken, ...extra });
}

test('profile submissions merge across devices', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  const id = await t.makeProfile(code(1), '카구야');
  const first = await play(t, player(1), 20000, { personalCode: code(1), nickname: '무시됨' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await play(t, player(2), 30000, { personalCode: code(1) });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.all, [{ rank: 1, nickname: '카구야', scoreMs: 30000, profileId: id }]);
  assert.deepEqual(second.body.me.all, { rank: 1, scoreMs: 30000 });
}));

test('typed nicknames cannot copy a profile nickname', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  await t.makeProfile(code(1), 'Kaguya');
  const res = await play(t, player(3), 10000, { nickname: 'kaguya' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'nickname taken');
}));

test('typed nicknames allow twelve characters', withClock(async () => {
  const t = await setupDisplay();
  const ok = await play(t, player(4), 10000, { nickname: '가'.repeat(12) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.all[0].profileId, null);
  const tooLong = await play(t, player(5), 10000, { nickname: '가'.repeat(13) });
  assert.equal(tooLong.body.error, 'invalid nickname');
}));

test('banning a profile row blocks every device', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  const id = await t.makeProfile(code(1));
  assert.equal((await play(t, player(6), 10000, { personalCode: code(1) })).status, 200);
  t.env.TAGS_DB.db.prepare('INSERT INTO game_bans (player_hash, reason, banned_at) VALUES (?, ?, ?)')
    .run(hash('spacegame-profile:' + id), null, clock.now);
  const res = await play(t, player(7), 20000, { personalCode: code(1) });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid nickname');
}));

test('ranking me prefers the profile row', withClock(async () => {
  const t = await setupDisplay();
  await play(t, player(8), 5000, { nickname: '브라우저' });
  await t.account(code(1));
  await t.makeProfile(code(1), '프로필');
  await play(t, player(9), 25000, { personalCode: code(1) });
  const withCode = await t.send('POST', '/game/ranking', { playerId: player(8), personalCode: code(1) });
  assert.equal(withCode.status, 200);
  assert.deepEqual(withCode.body.me.all, { rank: 1, scoreMs: 25000 });
  const withoutCode = await t.send('POST', '/game/ranking', { playerId: player(8) });
  assert.deepEqual(withoutCode.body.me.all, { rank: 2, scoreMs: 5000 });
}));

test('game works without profile tables', withClock(async () => {
  const t = await setupDisplay(BASE_SCHEMAS);
  await t.account(code(1));
  const res = await play(t, player(10), 10000, { personalCode: code(1), nickname: '직접입력' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.all, [{ rank: 1, nickname: '직접입력', scoreMs: 10000, profileId: null }]);
}));

test('orphan link rows of deleted profiles are ignored', withClock(async () => {
  const t = await setupDisplay();
  await t.account(code(1));
  const id = await t.makeProfile(code(1), '살아있음');
  t.tick();
  await t.vote(code(1), 123, '일상');
  await t.send('POST', '/bump/request', { personalCode: code(1), type: 'novel', id: 123 });
  await play(t, player(11), 8000, { personalCode: code(1) });
  // 삭제와 겹친 /profile/me 가 되살린 것 같은, 지워진 프로필의 연결 행
  t.env.TAGS_DB.db.prepare('INSERT INTO profile_links VALUES (?, ?, ?, ?, ?)')
    .run('ghostghost12', hash('tagvote:' + code(1)), hash('bump:' + code(1)), hash('spacegame-profile:ghostghost12'), 0);
  t.env.TAGS_DB.db.prepare("INSERT INTO game_scores VALUES ('all', ?, '유령', 9000, 1)").run(hash('spacegame-profile:ghostghost12'));
  assert.deepEqual((await t.voters(123, '일상')).body, { profileIds: [id], anonymous: 0 });
  assert.equal((await t.send('POST', '/bump/get', {})).body.active.requesterProfileId, id);
  const board = (await t.send('POST', '/game/ranking', {})).body.all;
  assert.equal(board.find(r => r.nickname === '유령').profileId, null);
  assert.equal(board.find(r => r.nickname === '살아있음').profileId, id);
}));

test('tags/voters route is exposed by the site worker', () => {
  const worker = fs.readFileSync(path.join(root, 'src/_worker.js'), 'utf8');
  assert.ok(worker.includes("'/tags/voters'"));
});

module.exports = { setupDisplay, withClock, code };
