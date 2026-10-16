// 프로필·계정 테스트 공용 준비 코드(setupDisplay 등).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, D1, Bucket, hash, allow, request, clock, root } = require('./workerHarness.cjs');

const ICONS = JSON.parse(fs.readFileSync(path.join(root, 'src/data/config/ProfileIcons.json'), 'utf8'));
const BASE_SCHEMAS = ['game_schema.sql', 'tags_schema.sql', 'bump_schema.sql', 'admin_schema.sql', 'login_schema.sql'];
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

module.exports = { setupDisplay, withClock, code, BASE_SCHEMAS, ALL_SCHEMAS };
