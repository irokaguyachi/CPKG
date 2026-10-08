// 유저 프로필 공개 API(설계: docs/superpowers/specs/2026-10-07-user-profile-design.md).
//   POST /profile/me     {personalCode}                         → { profile | null }
//   POST /profile/save   {personalCode, nickname, icon, color, bio} → { profile }
//   POST /profile/delete {personalCode}                         → { ok }
//   GET  /profiles?ids=a,b,c                                    → { profiles: { id: 공개 프로필 } }
// favoritesShareWorker.js 의 route() 가 PROFILE_PATHS 를 이리로 넘긴다. 응답·제한기·
// 개인 코드 검사 같은 공용 함수는 tools 로 받는다 — 거꾸로 import 하면 두 모듈이
// 서로를 import 하게 되기 때문이다.
// 프로필은 D1 profiles(worker/profile_schema.sql) 한 테이블에 둔다. 테이블이 없거나
// D1 이 실패하면 503 'profile unavailable' 을 돌려주고 다른 기능에는 영향이 없다.
import { cleanNickname, cleanText, bannedWordIn, RESERVED_NICKNAME_RE } from './nickname.js';

export const PROFILE_PATHS = ['/profile/me', '/profile/save', '/profile/delete', '/profiles'];

const NICKNAME_MAX = 12;
const BIO_MAX = 40;
const NICKNAME_COOLDOWN_MS = 7 * 86400000;
const LOOKUP_MAX = 50;
const BODY_MAX_BYTES = 2048;
const PROFILE_ID_RE = /^[A-Za-z0-9_-]{12}$/;
const CATALOG_PATH = '/data/config/ProfileIcons.json';
const PUBLIC_CACHE = 'public, max-age=30';

async function sha256Hex(str) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  var bytes = new Uint8Array(digest);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function ownerHash(personalCode) {
  return sha256Hex('profile:' + personalCode);
}

// 9바이트 → base64url 12자. 다른 사람에게 보이는 유일한 식별자라 개인 코드와 무관한 무작위 값이다.
function newProfileId() {
  var bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

export function nicknameKey(nickname) {
  return nickname.normalize('NFC').toLowerCase();
}

function publicView(row) {
  return { id: row.profile_id, nickname: row.nickname, icon: row.icon, color: row.color, bio: row.bio };
}

function mineView(row) {
  var view = publicView(row);
  view.nicknameChangeableAt = row.nickname_changed_at ? row.nickname_changed_at + NICKNAME_COOLDOWN_MS : 0;
  return view;
}

// ProfileIcons.json 은 정적 에셋이라 loadTagCatalog 와 같이 ASSETS 로 읽는다.
async function loadCatalog(request, env) {
  var url = new URL(request.url);
  url.pathname = CATALOG_PATH;
  url.search = '';
  var res = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  if (!res.ok) throw new Error('profile catalog unavailable');
  var data = await res.json();
  return {
    icons: (data.icons || []).map(function (i) { return i.id; }),
    colors: (data.colors || []).map(function (c) { return c.id; })
  };
}

// ---- 2단계: 활동 연결(profile_links) ----
export function gameHashFor(profileId) {
  return sha256Hex('spacegame-profile:' + profileId);
}

// 연결 행을 만든다(이미 있으면 그대로). 해시에 개인 코드가 필요해서 본인 요청 때만 부른다.
// 연결 테이블이 없거나 실패해도 프로필 기능은 막지 않는다 — 다음 /profile/me 때 다시 채운다.
async function ensureLink(env, profileId, personalCode, linkedAt) {
  try {
    await env.TAGS_DB.prepare(
      'INSERT OR IGNORE INTO profile_links (profile_id, vote_hash, bump_hash, game_hash, linked_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(profileId, await sha256Hex('tagvote:' + personalCode), await sha256Hex('bump:' + personalCode),
      await gameHashFor(profileId), linkedAt).run();
  } catch (e) {}
}

// 게임 등록처럼 개인 코드로 연결 정보를 찾는다. 프로필이 없거나 실패하면 null.
export async function profileLinkForCode(env, personalCode) {
  try {
    var row = await env.TAGS_DB.prepare('SELECT profile_id, nickname, created_at FROM profiles WHERE owner_hash = ?')
      .bind(await ownerHash(personalCode)).first();
    if (!row) return null;
    await ensureLink(env, row.profile_id, personalCode, row.created_at);
    return {
      profileId: row.profile_id, nickname: row.nickname, linkedAt: row.created_at,
      gameHash: await gameHashFor(row.profile_id)
    };
  } catch (e) {
    return null;
  }
}

// 게임 랭킹의 직접 입력 닉네임이 남의 프로필 닉네임과 같은지 본다. 없거나 실패하면 null.
export async function profileIdByNicknameKey(env, key) {
  try {
    var row = await env.TAGS_DB.prepare('SELECT profile_id FROM profiles WHERE nickname_key = ?').bind(key).first();
    return row ? row.profile_id : null;
  } catch (e) {
    return null;
  }
}

// 2단계(투표·끌올 기록)에서 개인 코드로 프로필 ID 를 찾는다. 없거나 실패하면 null.
export async function profileIdForCode(env, personalCode) {
  try {
    var row = await env.TAGS_DB.prepare('SELECT profile_id FROM profiles WHERE owner_hash = ?')
      .bind(await ownerHash(personalCode)).first();
    return row ? row.profile_id : null;
  } catch (e) {
    return null;
  }
}

async function readProfileBody(request, env, tools, limiter) {
  if (!(await tools.checkLimit(limiter, tools.clientIp(request)))) {
    return { error: tools.jsonResponse(request, { error: 'too many requests, try again later' }, 429) };
  }
  var body = await tools.readJsonBody(request, BODY_MAX_BYTES);
  if (body.error) return { error: body.error };
  var raw = body.value && typeof body.value === 'object' ? body.value : {};
  var personalCode = tools.cleanPersonalCode(raw.personalCode);
  if (personalCode === null) return { error: tools.jsonResponse(request, { error: 'invalid payload shape' }, 400) };
  return { personalCode: personalCode, raw: raw };
}

async function handleMe(request, env, tools) {
  var parsed = await readProfileBody(request, env, tools, env.RL_USER_AUTH);
  if (parsed.error) return parsed.error;
  var row = await env.TAGS_DB.prepare('SELECT * FROM profiles WHERE owner_hash = ?')
    .bind(await ownerHash(parsed.personalCode)).first();
  // 1단계에서 만든 프로필은 연결 행이 없어서 여기서 채운다(linked_at = 프로필을 만든 시각).
  if (row) await ensureLink(env, row.profile_id, parsed.personalCode, row.created_at);
  return tools.jsonResponse(request, { profile: row ? mineView(row) : null });
}

function uniqueError(e) {
  var message = String(e && e.message || '');
  if (message.indexOf('UNIQUE') === -1) return null;
  return message.indexOf('nickname_key') !== -1 ? 'nickname taken' : 'profile changed';
}

async function handleSave(request, env, tools) {
  var parsed = await readProfileBody(request, env, tools, env.RL_USER_SYNC);
  if (parsed.error) return parsed.error;
  var raw = parsed.raw;
  var fail = function (error, status, extra) {
    return tools.jsonResponse(request, Object.assign({ error: error }, extra || {}), status || 400);
  };

  var nickname = cleanNickname(raw.nickname, NICKNAME_MAX);
  if (nickname === null) return fail('invalid nickname');
  var bio = raw.bio === undefined ? '' : cleanText(raw.bio, BIO_MAX);
  if (bio === null) return fail('invalid bio');
  var catalog = await loadCatalog(request, env);
  if (catalog.icons.indexOf(raw.icon) === -1) return fail('invalid icon');
  if (catalog.colors.indexOf(raw.color) === -1) return fail('invalid color');

  if (!(await env.FAVORITES_BUCKET.head(await tools.userStoreKey(parsed.personalCode)))) {
    return fail('account not found', 404);
  }

  var owner = await ownerHash(parsed.personalCode);
  var existing = await env.TAGS_DB.prepare('SELECT * FROM profiles WHERE owner_hash = ?').bind(owner).first();
  var now = Date.now();
  var nicknameChanged = !existing || existing.nickname !== nickname;

  // 초기화된 이름(유저xxxxxx)은 그대로 둔 채 아이콘만 바꾸는 저장은 통과해야 한다.
  if (nicknameChanged && RESERVED_NICKNAME_RE.test(nickname)) return fail('reserved nickname');
  if (nicknameChanged && existing && existing.nickname_changed_at &&
      now < existing.nickname_changed_at + NICKNAME_COOLDOWN_MS) {
    return fail('nickname cooldown', 429, { retryAt: existing.nickname_changed_at + NICKNAME_COOLDOWN_MS });
  }
  // 바뀌는 글만 금지어를 본다 — 나중에 금지어가 된 기존 닉네임 때문에 아이콘조차 못 바꾸는 일이 없게.
  var texts = [];
  if (nicknameChanged) texts.push(nickname);
  if (!existing || existing.bio !== bio) texts.push(bio);
  if (texts.length && (await bannedWordIn(env, texts))) return fail('banned word');

  var row = {
    profile_id: existing ? existing.profile_id : newProfileId(),
    nickname: nickname, icon: raw.icon, color: raw.color, bio: bio,
    nickname_changed_at: existing ? (nicknameChanged ? now : existing.nickname_changed_at) : 0
  };
  try {
    if (!existing) {
      await env.TAGS_DB.prepare(
        'INSERT INTO profiles (profile_id, owner_hash, nickname, nickname_key, icon, color, bio, ' +
        'nickname_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(row.profile_id, owner, nickname, nicknameKey(nickname), row.icon, row.color, bio,
        row.nickname_changed_at, now, now).run();
    } else {
      // 읽은 뒤 같은 계정의 다른 저장이 닉네임을 먼저 바꿨으면 변경 간격을 건너뛰지 않게 막는다.
      var result = await env.TAGS_DB.prepare(
        'UPDATE profiles SET nickname = ?, nickname_key = ?, icon = ?, color = ?, bio = ?, ' +
        'nickname_changed_at = ?, updated_at = ? WHERE owner_hash = ? AND nickname_changed_at = ?'
      ).bind(nickname, nicknameKey(nickname), row.icon, row.color, bio, row.nickname_changed_at, now,
        owner, existing.nickname_changed_at).run();
      if (!(result.meta && result.meta.changes > 0)) return fail('profile changed', 409);
    }
  } catch (e) {
    var unique = uniqueError(e);
    if (unique) return fail(unique, 409);
    throw e;
  }
  await ensureLink(env, row.profile_id, parsed.personalCode, existing ? existing.created_at : now);
  return tools.jsonResponse(request, { profile: mineView(row) });
}

async function handleDelete(request, env, tools) {
  var parsed = await readProfileBody(request, env, tools, env.RL_USER_SYNC);
  if (parsed.error) return parsed.error;
  var owner = await ownerHash(parsed.personalCode);
  var target = await env.TAGS_DB.prepare('SELECT profile_id FROM profiles WHERE owner_hash = ?').bind(owner).first();
  if (!target) return tools.jsonResponse(request, { error: 'profile not found' }, 404);
  await env.TAGS_DB.prepare('DELETE FROM profiles WHERE owner_hash = ?').bind(owner).run();
  // 연결 행을 지우면 그 사람의 활동이 다시 익명이 된다. 테이블이 없으면 지울 것도 없다.
  try {
    await env.TAGS_DB.prepare('DELETE FROM profile_links WHERE profile_id = ?').bind(target.profile_id).run();
  } catch (e) {}
  return tools.jsonResponse(request, { ok: true });
}

// 다른 사람 프로필 여러 개를 한 번에 본다. 형식이 틀린 id 는 무시하고 중복은 합친다.
async function handleLookup(request, env, tools, url) {
  if (!(await tools.checkLimit(env.RL_LIB_LIST, tools.clientIp(request)))) {
    return tools.jsonResponse(request, { error: 'too many requests, try again later' }, 429);
  }
  var tokens = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
  if (tokens.length > LOOKUP_MAX) return tools.jsonResponse(request, { error: 'too many ids' }, 400);
  var ids = tokens.filter(function (id, i) { return PROFILE_ID_RE.test(id) && tokens.indexOf(id) === i; });
  var profiles = {};
  if (ids.length) {
    var statement = env.TAGS_DB.prepare(
      'SELECT profile_id, nickname, icon, color, bio FROM profiles WHERE profile_id IN (' +
      ids.map(function () { return '?'; }).join(', ') + ')'
    );
    var rows = (await statement.bind.apply(statement, ids).all()).results || [];
    rows.forEach(function (row) { profiles[row.profile_id] = publicView(row); });
  }
  var res = tools.jsonResponse(request, { profiles: profiles });
  res.headers.set('Cache-Control', PUBLIC_CACHE);
  return res;
}

export async function handleProfileRequest(request, env, tools) {
  var url = new URL(request.url);
  try {
    if (url.pathname === '/profiles' && request.method === 'GET') return await handleLookup(request, env, tools, url);
    if (request.method === 'POST') {
      if (url.pathname === '/profile/me') return await handleMe(request, env, tools);
      if (url.pathname === '/profile/save') return await handleSave(request, env, tools);
      if (url.pathname === '/profile/delete') return await handleDelete(request, env, tools);
    }
    return tools.jsonResponse(request, { error: 'not found' }, 404);
  } catch (e) {
    return tools.jsonResponse(request, { error: 'profile unavailable' }, 503);
  }
}
