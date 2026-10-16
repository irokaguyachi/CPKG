// 아이디 로그인 API(설계: docs/superpowers/specs/2026-10-16-login-id-design.md).
//   POST /user/login    {loginId}                → { personalCode, loginId }
//   POST /login-id/set  {personalCode, loginId}  → { loginId, changeableAt }
//   POST /login-id/me   {personalCode}           → { loginId | null, changeableAt }
// favoritesShareWorker.js 의 route() 가 LOGIN_ID_PATHS 를 이리로 넘긴다. 공용 함수는
// profileApi.js 와 같은 이유로 tools 로 받는다(서로 import 하면 순환).
// 테이블(worker/login_schema.sql)이 없거나 D1 이 실패하면 503 'login id unavailable'.
import { profileOwnerHash, userStoreKey } from './accountKeys.js';
import { LOGIN_CODE_DEADLINE, LOGIN_ID_COOLDOWN_MS, normalizeLoginId } from './loginIdConfig.js';

export const LOGIN_ID_PATHS = ['/user/login', '/login-id/set', '/login-id/me'];

var BODY_MAX_BYTES = 2048;

// 이 코드의 아이디와 마지막 변경 시각. 없으면 null, D1 오류면 throw.
export async function loginIdForCode(env, personalCode) {
  var row = await env.TAGS_DB.prepare('SELECT id_key, changed_at FROM login_ids WHERE personal_code = ?')
    .bind(personalCode).first();
  return row ? { loginId: row.id_key, changedAt: row.changed_at } : null;
}

function isUnique(e) {
  return String(e && e.message || '').indexOf('UNIQUE') !== -1;
}

// 처음 연결(changed_at = 0). 이미 쓰이는 아이디(또는 이미 아이디가 있는 코드)면 'taken'.
export async function insertLoginId(env, loginId, personalCode, now) {
  try {
    await env.TAGS_DB.prepare(
      'INSERT INTO login_ids (id_key, personal_code, owner_hash, changed_at, created_at, updated_at) ' +
      'VALUES (?, ?, ?, 0, ?, ?)'
    ).bind(loginId, personalCode, await profileOwnerHash(personalCode), now, now).run();
    return 'ok';
  } catch (e) {
    if (isUnique(e)) return 'taken';
    throw e;
  }
}

function changeableAt(changedAt) {
  return changedAt ? changedAt + LOGIN_ID_COOLDOWN_MS : 0;
}

async function readBody(request, tools, limiter) {
  if (!(await tools.checkLimit(limiter, tools.clientIp(request)))) {
    return { error: tools.jsonResponse(request, { error: 'too many requests, try again later' }, 429) };
  }
  var body = await tools.readJsonBody(request, BODY_MAX_BYTES);
  if (body.error) return { error: body.error };
  return { raw: body.value && typeof body.value === 'object' ? body.value : {} };
}

async function readAccountBody(request, tools, limiter) {
  var parsed = await readBody(request, tools, limiter);
  if (parsed.error) return parsed;
  var personalCode = tools.cleanPersonalCode(parsed.raw.personalCode);
  if (personalCode === null) return { error: tools.jsonResponse(request, { error: 'invalid payload shape' }, 400) };
  parsed.personalCode = personalCode;
  return parsed;
}

async function handleLogin(request, env, tools) {
  var parsed = await readBody(request, tools, env.RL_USER_AUTH);
  if (parsed.error) return parsed.error;
  var loginId = normalizeLoginId(parsed.raw.loginId);
  if (loginId === null) return tools.jsonResponse(request, { error: 'invalid login id' }, 400);
  var row = await env.TAGS_DB.prepare('SELECT personal_code FROM login_ids WHERE id_key = ?').bind(loginId).first();
  if (!row) return tools.jsonResponse(request, { error: 'login id not found' }, 404);
  return tools.jsonResponse(request, { personalCode: row.personal_code, loginId: loginId });
}

async function handleMe(request, env, tools) {
  var parsed = await readAccountBody(request, tools, env.RL_USER_SYNC);
  if (parsed.error) return parsed.error;
  var gone = await tools.deletedAccountResponse(request, env, parsed.personalCode);
  if (gone) return gone;
  var mine = await loginIdForCode(env, parsed.personalCode);
  return tools.jsonResponse(request, {
    loginId: mine ? mine.loginId : null,
    changeableAt: mine ? changeableAt(mine.changedAt) : 0
  });
}

async function handleSet(request, env, tools) {
  var parsed = await readAccountBody(request, tools, env.RL_USER_SYNC);
  if (parsed.error) return parsed.error;
  var fail = function (error, status, extra) {
    return tools.jsonResponse(request, Object.assign({ error: error }, extra || {}), status);
  };
  var loginId = normalizeLoginId(parsed.raw.loginId);
  if (loginId === null) return fail('invalid login id', 400);
  var gone = await tools.deletedAccountResponse(request, env, parsed.personalCode);
  if (gone) return gone;
  if (!(await env.FAVORITES_BUCKET.head(await userStoreKey(parsed.personalCode)))) {
    return fail('account not found', 404);
  }

  var code = parsed.personalCode;
  var now = Date.now();
  var existing = await loginIdForCode(env, code);
  if (!existing) {
    // 마감 뒤에는 아이디 없는 코드 계정이 지워질 대상이라 처음 만드는 아이디를 받지 않는다
    // (정리 도중 되살아나는 것을 막는다). 이미 있는 아이디를 바꾸는 것은 계속 된다.
    if (now >= LOGIN_CODE_DEADLINE) return fail('account deleted', 410);
    var inserted = await insertLoginId(env, loginId, code, now);
    if (inserted === 'taken') return fail('login id taken', 409);
    return tools.jsonResponse(request, { loginId: loginId, changeableAt: 0 });
  }
  // 같은 아이디로 다시 설정하면 변경이 아니라서 쿨타임도 걸리지 않는다.
  if (existing.loginId === loginId) {
    return tools.jsonResponse(request, { loginId: loginId, changeableAt: changeableAt(existing.changedAt) });
  }
  if (existing.changedAt && now < existing.changedAt + LOGIN_ID_COOLDOWN_MS) {
    return fail('login id cooldown', 429, { retryAt: existing.changedAt + LOGIN_ID_COOLDOWN_MS });
  }
  try {
    // 한 문장으로 바꿔서 예전 아이디가 사라지거나 둘 다 남는 일이 없고, 읽은 뒤 같은 계정의
    // 다른 변경이 먼저 끝났으면(changed_at 이 달라졌으면) 쿨타임을 건너뛰지 않게 막는다.
    var result = await env.TAGS_DB.prepare(
      'UPDATE login_ids SET id_key = ?, changed_at = ?, updated_at = ? WHERE personal_code = ? AND changed_at = ?'
    ).bind(loginId, now, now, code, existing.changedAt).run();
    if (!(result.meta && result.meta.changes > 0)) return fail('login id changed', 409);
  } catch (e) {
    if (isUnique(e)) return fail('login id taken', 409);
    throw e;
  }
  return tools.jsonResponse(request, { loginId: loginId, changeableAt: changeableAt(now) });
}

export async function handleLoginIdRequest(request, env, tools) {
  if (request.method !== 'POST') return tools.jsonResponse(request, { error: 'method not allowed' }, 405);
  var pathname = new URL(request.url).pathname;
  try {
    if (pathname === '/user/login') return await handleLogin(request, env, tools);
    if (pathname === '/login-id/set') return await handleSet(request, env, tools);
    return await handleMe(request, env, tools);
  } catch (e) {
    console.error('login id failed', e && e.message);
    return tools.jsonResponse(request, { error: 'login id unavailable' }, 503);
  }
}
