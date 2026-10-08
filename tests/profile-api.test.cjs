// 유저 프로필(worker/nickname.js, worker/profileApi.js) 검증.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, D1 } = require('./helpers/workerHarness.cjs');

test('cleanNickname trims, strips invisible chars and enforces max', async () => {
  const { cleanNickname } = await load('worker/nickname.js');
  assert.equal(cleanNickname('  카구야​  짱 ', 12), '카구야 짱');
  assert.equal(cleanNickname('가'.repeat(12), 12), '가'.repeat(12));
  assert.equal(cleanNickname('가'.repeat(13), 12), null);
  assert.equal(cleanNickname('   ', 12), null);
  assert.equal(cleanNickname(5, 12), null);
});

test('bannedWordIn matches lowercase substrings and fails open', async () => {
  const { bannedWordIn } = await load('worker/nickname.js');
  const db = new D1(['admin_schema.sql']);
  db.db.exec("INSERT INTO banned_nicknames VALUES ('bad', 1)");
  assert.equal(await bannedWordIn({ TAGS_DB: db }, ['ok', 'xBADx']), true);
  assert.equal(await bannedWordIn({ TAGS_DB: db }, ['ok']), false);
  assert.equal(await bannedWordIn({ TAGS_DB: new D1([]) }, ['bad']), false);
});

test('reserved nickname pattern covers admin reset names only', async () => {
  const { RESERVED_NICKNAME_RE } = await load('worker/nickname.js');
  assert.ok(RESERVED_NICKNAME_RE.test('유저abc123'));
  assert.ok(RESERVED_NICKNAME_RE.test('유저abcdefghijkl'));
  assert.ok(!RESERVED_NICKNAME_RE.test('유저'));
  assert.ok(!RESERVED_NICKNAME_RE.test('유저 abc123'));
  assert.ok(!RESERVED_NICKNAME_RE.test('유저abc12'));
});

test('profile schema applies twice', () => {
  const db = new D1(['profile_schema.sql', 'profile_schema.sql']);
  const names = db.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name);
  assert.ok(names.includes('profiles'));
});

// ---- 공개 프로필 API ----
const fs = require('node:fs');
const path = require('node:path');
const { Bucket, hash, allow, request, clock, root } = require('./helpers/workerHarness.cjs');
const ICONS = JSON.parse(fs.readFileSync(path.join(root, 'src/data/config/ProfileIcons.json'), 'utf8'));
const CODE_A = 'profile_code_aaaa_0001';
const CODE_B = 'profile_code_bbbb_0002';
const DAY = 86400000;

async function setupProfiles(schemas = ['admin_schema.sql', 'profile_schema.sql']) {
  const backend = (await load('worker/favoritesShareWorker.js')).default;
  const profileApi = await load('worker/profileApi.js');
  const env = {
    TAGS_DB: new D1(schemas), FAVORITES_BUCKET: new Bucket(),
    RL_USER_AUTH: allow, RL_USER_SYNC: allow, RL_LIB_LIST: allow,
    ASSETS: { fetch: async req => {
      const p = decodeURIComponent(new URL(req.url).pathname);
      if (p === '/data/config/ProfileIcons.json') return Response.json(ICONS);
      return new Response('not found', { status: 404 });
    } }
  };
  const send = async (method, url, body) => {
    const res = await backend.fetch(request(method, url, body), env);
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  const account = code => env.FAVORITES_BUCKET.put('user/' + hash('user-v2:' + code) + '.json', '{}');
  const save = (code, fields = {}) => send('POST', '/profile/save', {
    personalCode: code, nickname: 'Kaguya', icon: 'fushi-nyam', color: 'rose', bio: '', ...fields
  });
  return { env, send, account, save, profileApi };
}

test('save creates a profile and me returns it', async () => {
  const { send, account, save } = await setupProfiles();
  await account(CODE_A);
  const res = await save(CODE_A, { bio: '안녕' });
  assert.equal(res.status, 200);
  assert.match(res.body.profile.id, /^[A-Za-z0-9_-]{12}$/);
  assert.deepEqual(
    { ...res.body.profile, id: 'x' },
    { id: 'x', nickname: 'Kaguya', icon: 'fushi-nyam', color: 'rose', bio: '안녕', nicknameChangeableAt: 0 }
  );
  const me = await send('POST', '/profile/me', { personalCode: CODE_A });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.profile, res.body.profile);
});

test('me returns null without a profile', async () => {
  const { send, account } = await setupProfiles();
  await account(CODE_A);
  const me = await send('POST', '/profile/me', { personalCode: CODE_A });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { profile: null });
});

test('save rejects codes without an account', async () => {
  const { save } = await setupProfiles();
  const res = await save(CODE_A);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'account not found');
});

test('nicknames are unique ignoring case', async () => {
  const { account, save } = await setupProfiles();
  await account(CODE_A); await account(CODE_B);
  assert.equal((await save(CODE_A, { nickname: 'Kaguya' })).status, 200);
  const res = await save(CODE_B, { nickname: 'kaguya' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'nickname taken');
});

test('concurrent saves of one nickname let only one win', async () => {
  const { account, save } = await setupProfiles();
  await account(CODE_A); await account(CODE_B);
  const results = await Promise.all([save(CODE_A, { nickname: '같은이름' }), save(CODE_B, { nickname: '같은이름' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});

test('nickname change waits seven days after the first change', async () => {
  const { account, save } = await setupProfiles();
  await account(CODE_A);
  assert.equal((await save(CODE_A, { nickname: '처음' })).status, 200);
  const changedAt = clock.now;
  const first = await save(CODE_A, { nickname: '두번째' });
  assert.equal(first.status, 200, 'the first rename after creation is free');
  assert.equal(first.body.profile.nicknameChangeableAt, changedAt + 7 * DAY);
  const blocked = await save(CODE_A, { nickname: '세번째' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, 'nickname cooldown');
  assert.equal(blocked.body.retryAt, changedAt + 7 * DAY);
  const saved = clock.now;
  clock.now += 7 * DAY;
  try {
    assert.equal((await save(CODE_A, { nickname: '세번째' })).status, 200);
  } finally {
    clock.now = saved;
  }
});

test('same nickname or icon-only saves skip the cooldown', async () => {
  const { account, save } = await setupProfiles();
  await account(CODE_A);
  await save(CODE_A, { nickname: '처음' });
  await save(CODE_A, { nickname: '두번째' });
  const res = await save(CODE_A, { nickname: '두번째', icon: 'fushi-sleep', color: 'teal', bio: '바꿈' });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.icon, 'fushi-sleep');
  assert.equal(res.body.profile.bio, '바꿈');
});

test('banned words are rejected in nickname and bio', async () => {
  const { env, account, save } = await setupProfiles();
  env.TAGS_DB.db.exec("INSERT INTO banned_nicknames VALUES ('나쁜말', 1)");
  await account(CODE_A);
  for (const fields of [{ nickname: '나쁜말쟁이' }, { bio: '저는 나쁜말 해요' }]) {
    const res = await save(CODE_A, fields);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'banned word');
  }
});

test('reserved and invalid fields are rejected', async () => {
  const { account, save } = await setupProfiles();
  await account(CODE_A);
  const cases = [
    [{ nickname: '유저abc123' }, 'reserved nickname'],
    [{ nickname: '가'.repeat(13) }, 'invalid nickname'],
    [{ nickname: '  ' }, 'invalid nickname'],
    [{ bio: '가'.repeat(41) }, 'invalid bio'],
    [{ bio: 3 }, 'invalid bio'],
    [{ icon: 'nope' }, 'invalid icon'],
    [{ color: 'nope' }, 'invalid color']
  ];
  for (const [fields, error] of cases) {
    const res = await save(CODE_A, fields);
    assert.equal(res.status, 400, error);
    assert.equal(res.body.error, error);
  }
  const ok = await save(CODE_A, { nickname: '가'.repeat(12), bio: '나'.repeat(40) });
  assert.equal(ok.status, 200);
});

test('delete removes the profile', async () => {
  const { send, account, save } = await setupProfiles();
  await account(CODE_A);
  await save(CODE_A);
  assert.equal((await send('POST', '/profile/delete', { personalCode: CODE_A })).status, 200);
  assert.deepEqual((await send('POST', '/profile/me', { personalCode: CODE_A })).body, { profile: null });
  const again = await send('POST', '/profile/delete', { personalCode: CODE_A });
  assert.equal(again.status, 404);
  // 지운 닉네임은 다른 사람이 바로 쓸 수 있다
  await account(CODE_B);
  assert.equal((await save(CODE_B)).status, 200);
});

test('public lookup returns only public fields', async () => {
  const { send, account, save } = await setupProfiles();
  await account(CODE_A);
  const id = (await save(CODE_A, { bio: '공개' })).body.profile.id;
  const res = await send('GET', '/profiles?ids=' + [id, id, 'bad!', 'zzzzzzzzzzzz'].join(','));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.profiles), [id]);
  assert.deepEqual(res.body.profiles[id], { id, nickname: 'Kaguya', icon: 'fushi-nyam', color: 'rose', bio: '공개' });
  assert.match(res.headers.get('Cache-Control'), /max-age=30/);
  const many = Array.from({ length: 51 }, (_, i) => 'id' + String(i).padStart(10, '0'));
  assert.equal((await send('GET', '/profiles?ids=' + many.join(','))).status, 400);
  assert.deepEqual((await send('GET', '/profiles?ids=')).body, { profiles: {} });
});

test('profileIdForCode finds the id', async () => {
  const { env, account, save, profileApi } = await setupProfiles();
  await account(CODE_A);
  const id = (await save(CODE_A)).body.profile.id;
  assert.equal(await profileApi.profileIdForCode(env, CODE_A), id);
  assert.equal(await profileApi.profileIdForCode(env, CODE_B), null);
});

test('missing table returns 503', async () => {
  const { account, save, send } = await setupProfiles(['admin_schema.sql']);
  await account(CODE_A);
  const res = await save(CODE_A);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'profile unavailable');
  assert.equal((await send('GET', '/profiles?ids=abcdefghijkl')).status, 503);
});

// ---- 2단계: 활동 연결(profile_links) ----
test('profile creation writes a link row', async () => {
  const { env, account, save } = await setupProfiles();
  await account(CODE_A);
  const id = (await save(CODE_A)).body.profile.id;
  const links = env.TAGS_DB.rows('SELECT * FROM profile_links');
  assert.deepEqual(links, [{
    profile_id: id, vote_hash: hash('tagvote:' + CODE_A), bump_hash: hash('bump:' + CODE_A),
    game_hash: hash('spacegame-profile:' + id), linked_at: clock.now
  }]);
});

test('me backfills a missing link for stage-1 profiles', async () => {
  const { env, send, account, save } = await setupProfiles();
  await account(CODE_A);
  const createdAt = clock.now;
  const id = (await save(CODE_A)).body.profile.id;
  env.TAGS_DB.db.exec('DELETE FROM profile_links');
  const saved = clock.now;
  clock.now += 5 * DAY;
  try {
    assert.equal((await send('POST', '/profile/me', { personalCode: CODE_A })).status, 200);
  } finally {
    clock.now = saved;
  }
  const links = env.TAGS_DB.rows('SELECT profile_id, linked_at FROM profile_links');
  assert.deepEqual(links, [{ profile_id: id, linked_at: createdAt }]);
});

test('deleting a profile removes its link', async () => {
  const { env, send, account, save } = await setupProfiles();
  await account(CODE_A);
  await save(CODE_A);
  await send('POST', '/profile/delete', { personalCode: CODE_A });
  assert.deepEqual(env.TAGS_DB.rows('SELECT * FROM profile_links'), []);
});

test('profileLinkForCode and profileIdByNicknameKey', async () => {
  const { env, account, save, profileApi } = await setupProfiles();
  await account(CODE_A);
  const id = (await save(CODE_A, { nickname: 'Kaguya' })).body.profile.id;
  const link = await profileApi.profileLinkForCode(env, CODE_A);
  assert.deepEqual({ ...link }, { profileId: id, nickname: 'Kaguya', linkedAt: clock.now, gameHash: hash('spacegame-profile:' + id) });
  assert.equal(await profileApi.gameHashFor(id), hash('spacegame-profile:' + id));
  assert.equal(await profileApi.profileLinkForCode(env, CODE_B), null);
  assert.equal(await profileApi.profileIdByNicknameKey(env, 'kaguya'), id);
  assert.equal(await profileApi.profileIdByNicknameKey(env, 'nobody'), null);
  const bare = { TAGS_DB: new D1([]) };
  assert.equal(await profileApi.profileLinkForCode(bare, CODE_A), null);
  assert.equal(await profileApi.profileIdByNicknameKey(bare, 'kaguya'), null);
});

test('profile routes are exposed by the site worker', () => {
  const worker = fs.readFileSync(path.join(root, 'src/_worker.js'), 'utf8');
  for (const p of ['/profile/me', '/profile/save', '/profile/delete', '/profiles']) {
    assert.ok(worker.includes("'" + p + "'"), p);
  }
});
