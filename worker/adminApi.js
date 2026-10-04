import { json, readBody, intParam } from './adminCommon.js';
import { gameRoutes } from './adminGame.js';
import { tagRoutes } from './adminTags.js';
import { bumpRoutes } from './adminBumps.js';
import { libraryRoutes } from './adminLibrary.js';

/**
 * adminApi — 관리 페이지(/admin, src/js/pages/adminPage.js)용 API.
 * src/_worker.js 가 /api/admin/* 를 이 모듈로 넘긴다.
 *
 * 인증(계정 + 비밀번호 2단계):
 * - 이 사이트의 "계정"은 개인 코드이고, 계정 저장소 키는
 *   user/<sha256('user-v2:' + personalCode)>.json 이다. 관리자 계정은 그 해시를
 *   시크릿 ADMIN_USER_HASHES(쉼표 구분)에 넣어 지정한다. 해시는 공개 버킷의
 *   파일 경로이기도 해서 toml 이나 코드에 쓰면 안 된다.
 * - POST /api/admin/login { personalCode, password } 가 계정 해시와
 *   ADMIN_PASSWORD 를 둘 다 확인하고, ADMIN_SESSION_SECRET 으로 서명한 12시간
 *   세션 토큰을 준다. 이후 요청은 Authorization: Bearer <token>.
 * - 토큰에는 관리자 해시 앞 12자(a)가 들어 있어서, ADMIN_USER_HASHES 에서 빠진
 *   관리자의 세션은 바로 무효가 된다. ADMIN_SESSION_SECRET 을 바꾸면 모든
 *   세션이 무효가 된다.
 * - 시크릿 셋 중 하나라도 없으면 전체가 503 이다(실수로 열린 채 배포되지 않게).
 *
 * 기능별 라우트는 adminGame.js / adminTags.js / adminBumps.js / adminLibrary.js 가
 * { 'METHOD /path': handler(request, env, ctx, session, url) } 모양으로 내보낸다.
 * 데이터를 바꾸는 핸들러는 변경과 작업 기록(adminCommon.logAction)을 한 batch 로 묶는다.
 */

var SESSION_TTL_MS = 12 * 3600000;
var ACTOR_LENGTH = 12;
var ACTIONS_PAGE_SIZE = 50;
var PERSONAL_CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;
var TOKEN_RE = /^[A-Za-z0-9_-]{16,400}\.[A-Za-z0-9_-]{43}$/;

async function sha256Hex(str) {
  var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  var bytes = new Uint8Array(digest);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64UrlEncode(bytes) {
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text) {
  var binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function configured(env) {
  return !!(env.ADMIN_USER_HASHES && env.ADMIN_PASSWORD && env.ADMIN_SESSION_SECRET);
}

function adminHashes(env) {
  return String(env.ADMIN_USER_HASHES || '').split(',')
    .map(function (h) { return h.trim().toLowerCase(); })
    .filter(function (h) { return /^[0-9a-f]{64}$/.test(h); });
}

function sessionKey(env) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.ADMIN_SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

// 관리자 로그인은 비밀번호 대입의 표적이라, 레이트리밋 바인딩이 없거나 장애가
// 나면 통과시키지 않고 막는다(공개 API 의 checkLimit 과 반대 방향).
async function loginAllowed(env, request) {
  if (!env.RL_ADMIN_LOGIN) return false;
  try {
    var r = await env.RL_ADMIN_LOGIN.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    return !!r.success;
  } catch (e) {
    return false;
  }
}

async function handleLogin(request, env) {
  if (!(await loginAllowed(env, request))) return json({ error: 'too many requests, try again later' }, 429);
  var body = await readBody(request);
  if (body instanceof Response) return body;

  var code = typeof body.personalCode === 'string' ? body.personalCode.trim() : '';
  var password = typeof body.password === 'string' ? body.password : '';
  // 계정과 비밀번호 확인을 둘 다 끝까지 해서, 어느 쪽이 틀렸는지 응답 시간으로도 덜 드러나게 한다.
  var accountHash = PERSONAL_CODE_RE.test(code) ? await sha256Hex('user-v2:' + code) : '';
  var accountOk = adminHashes(env).some(function (h) { return safeEqual(h, accountHash); });
  var passwordOk = safeEqual(await sha256Hex('admin-pw:' + password), await sha256Hex('admin-pw:' + env.ADMIN_PASSWORD));
  if (!accountOk || !passwordOk) return json({ error: 'unauthorized' }, 401);

  var expiresAt = Date.now() + SESSION_TTL_MS;
  var payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    k: 'admin', a: accountHash.slice(0, ACTOR_LENGTH), e: expiresAt
  })));
  var sig = await crypto.subtle.sign('HMAC', await sessionKey(env), new TextEncoder().encode(payload));
  return json({ token: payload + '.' + base64UrlEncode(new Uint8Array(sig)), expiresAt: expiresAt });
}

// 유효한 세션이면 { actor } 를, 아니면 401 응답을 돌려준다.
export async function requireSession(request, env) {
  var header = request.headers.get('Authorization') || '';
  var token = header.indexOf('Bearer ') === 0 ? header.slice(7).trim() : '';
  if (!TOKEN_RE.test(token)) return json({ error: 'unauthorized' }, 401);
  var dot = token.indexOf('.');
  var payloadText = token.slice(0, dot);
  try {
    var ok = await crypto.subtle.verify(
      'HMAC', await sessionKey(env), base64UrlDecode(token.slice(dot + 1)), new TextEncoder().encode(payloadText)
    );
    if (!ok) return json({ error: 'unauthorized' }, 401);
    var payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadText)));
    if (!payload || payload.k !== 'admin' || typeof payload.e !== 'number' || payload.e <= Date.now()) {
      return json({ error: 'unauthorized' }, 401);
    }
    var stillAdmin = adminHashes(env).some(function (h) { return h.slice(0, ACTOR_LENGTH) === payload.a; });
    if (!stillAdmin) return json({ error: 'unauthorized' }, 401);
    return { actor: payload.a };
  } catch (e) {
    return json({ error: 'unauthorized' }, 401);
  }
}

// GET /api/admin/actions?action=&before= — 최근 작업 기록 50건. action 은 접두사
// 필터(예: 'game' → game.*), before 는 이전 페이지의 마지막 id.
async function handleActions(request, env, ctx, session, url) {
  var action = (url.searchParams.get('action') || '').trim();
  var before = intParam(url.searchParams.get('before'));
  var sql = 'SELECT id, at, actor, action, target, detail FROM admin_actions WHERE 1 = 1';
  var args = [];
  if (action) { sql += ' AND (action = ? OR action LIKE ?)'; args.push(action, action + '.%'); }
  if (before) { sql += ' AND id < ?'; args.push(before); }
  sql += ' ORDER BY id DESC LIMIT ?';
  args.push(ACTIONS_PAGE_SIZE);
  var stmt = env.TAGS_DB.prepare(sql);
  var rows = (await stmt.bind.apply(stmt, args).all()).results || [];
  var items = rows.map(function (r) {
    var detail = null;
    try { detail = r.detail ? JSON.parse(r.detail) : null; } catch (e) { detail = r.detail; }
    return { id: r.id, at: r.at, actor: r.actor, action: r.action, target: r.target, detail: detail };
  });
  return json({ items: items, nextBefore: items.length === ACTIONS_PAGE_SIZE ? items[items.length - 1].id : null });
}

var ROUTES = Object.assign({
  'GET /actions': handleActions
}, gameRoutes, tagRoutes, bumpRoutes, libraryRoutes);

export default {
  async fetch(request, env, ctx) {
    if (!configured(env)) return json({ error: 'admin is not configured' }, 503);
    var url = new URL(request.url);
    var path = url.pathname.slice('/api/admin'.length);
    try {
      if (path === '/login' && request.method === 'POST') return await handleLogin(request, env);
      var handler = ROUTES[request.method + ' ' + path];
      if (!handler) return json({ error: 'not found' }, 404);
      var session = await requireSession(request, env);
      if (session instanceof Response) return session;
      return await handler(request, env, ctx, session, url);
    } catch (e) {
      console.error('admin api failed', e && e.message);
      return json({ error: 'internal error' }, 500);
    }
  }
};
