import { json, readBody, intParam } from './adminCommon.js';
import { gameRoutes } from './adminGame.js';
import { tagRoutes } from './adminTags.js';
import { bumpRoutes } from './adminBumps.js';
import { libraryRoutes } from './adminLibrary.js';
import { officialTagRoutes } from './adminOfficialTags.js';

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
  var token = await signToken(env, { k: 'admin', a: accountHash.slice(0, ACTOR_LENGTH), e: expiresAt });
  return json({ token: token, expiresAt: expiresAt });
}

// 세션 토큰과 /admin 확인 쿠키가 같은 서명 형식을 쓴다:
// base64url(JSON{ k, a, e }) + '.' + base64url(HMAC-SHA256). k(종류)가 달라서
// 한쪽을 다른 쪽 자리에 쓸 수 없다.
async function signToken(env, payload) {
  var body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  var sig = await crypto.subtle.sign('HMAC', await sessionKey(env), new TextEncoder().encode(body));
  return body + '.' + base64UrlEncode(new Uint8Array(sig));
}

// 서명·종류·만료가 맞고, 그 관리자가 아직 ADMIN_USER_HASHES 에 있으면 actor 를, 아니면 null.
async function readToken(env, token, kind) {
  if (!configured(env) || typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  var dot = token.indexOf('.');
  var body = token.slice(0, dot);
  try {
    var ok = await crypto.subtle.verify(
      'HMAC', await sessionKey(env), base64UrlDecode(token.slice(dot + 1)), new TextEncoder().encode(body)
    );
    if (!ok) return null;
    var payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
    if (!payload || payload.k !== kind || typeof payload.e !== 'number' || payload.e <= Date.now()) return null;
    var stillAdmin = adminHashes(env).some(function (h) { return h.slice(0, ACTOR_LENGTH) === payload.a; });
    return stillAdmin ? payload.a : null;
  } catch (e) {
    return null;
  }
}

// 유효한 세션이면 { actor } 를, 아니면 401 응답을 돌려준다.
export async function requireSession(request, env) {
  var header = request.headers.get('Authorization') || '';
  var actor = await readToken(env, header.indexOf('Bearer ') === 0 ? header.slice(7).trim() : '', 'admin');
  return actor ? { actor: actor } : json({ error: 'unauthorized' }, 401);
}

// ---- /admin 진입 차단(확인 쿠키) ----
// 개인 코드는 브라우저 localStorage 에만 있어서 주소창으로 /admin 을 열 때 서버는
// 누가 왔는지 모른다. 그래서 관리자 계정임을 확인받은 브라우저에만 HttpOnly 확인
// 쿠키를 주고, 쿠키가 없으면 관리 페이지 대신 작은 확인 페이지를 내려준다. 그
// 페이지가 개인 코드를 POST /api/admin/gate 로 보내 관리자면 쿠키를 받고 새로고침,
// 아니면 메인으로 보낸다 — 일반 유저는 관리 페이지의 HTML·JS·CSS 를 받지 않는다.
// 쿠키는 페이지를 여는 데까지만 쓰이고, 데이터는 여전히 비밀번호 세션이 필요하다.
var GATE_COOKIE = 'cpkg_admin_gate';
var GATE_TTL_S = 30 * 86400;
var GATE_FLAGS = '; HttpOnly; Secure; SameSite=Strict';
var ADMIN_PAGE = '/page/adminPage.html';
// 쿠키가 있어야만 내려주는 관리 페이지 자산(src/wrangler.toml 의 run_worker_first 와 짝).
var GATED_ASSETS = ['/js/pages/adminPage.js', '/css/pages/admin-page.css'];

var GATE_PAGE = [
  '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="robots" content="noindex, nofollow"><title>초카공 문학&amp;번역</title>',
  '<style>html,body{margin:0;min-height:100vh;background:#121316}',
  '@media (prefers-color-scheme: light){html,body{background:#ffffff}}</style></head><body><script>',
  // 쿠키를 받고 다시 열 때 ?gate=1 을 단다. 그런데도 이 페이지가 또 나오면(쿠키가
  // 저장되지 않는 브라우저) 무한 새로고침 대신 메인으로 보낸다.
  '(function(){var code=null;try{code=localStorage.getItem("chokaguya_personal_code")}catch(e){}',
  'if(!code||/[?&]gate=1/.test(location.search)){location.replace(\'/\');return}',
  'fetch("/api/admin/gate",{method:"POST",headers:{"Content-Type":"application/json"},',
  'body:JSON.stringify({personalCode:code}),credentials:"same-origin"})',
  '.then(function(r){if(r.ok)location.replace(location.pathname+"?gate=1"+location.hash);else location.replace(\'/\')})',
  '.catch(function(){location.replace(\'/\')})})();',
  '</script></body></html>'
].join('');

function readCookie(request, name) {
  var parts = (request.headers.get('Cookie') || '').split(';');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].trim();
    if (kv.indexOf(name + '=') === 0) return kv.slice(name.length + 1);
  }
  return '';
}

function gateCookie(value, maxAge) {
  return GATE_COOKIE + '=' + value + '; Path=/; Max-Age=' + maxAge + GATE_FLAGS;
}

function noStore(response) {
  var res = new Response(response.body, response);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

// src/_worker.js 가 모든 요청마다 부른다. 관리 페이지 경로면 응답을, 아니면 null.
export async function serveAdminGate(request, env) {
  var url = new URL(request.url);
  var isPage = url.pathname === '/admin' || url.pathname === '/admin/';
  if (!isPage && GATED_ASSETS.indexOf(url.pathname) === -1) return null;
  var allowed = !!(await readToken(env, readCookie(request, GATE_COOKIE), 'gate'));
  if (isPage) {
    if (!allowed) {
      return new Response(GATE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    var pageUrl = new URL(url);
    pageUrl.pathname = ADMIN_PAGE;
    return noStore(await env.ASSETS.fetch(new Request(pageUrl, request)));
  }
  if (!allowed) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return noStore(await env.ASSETS.fetch(request));
}

// POST /api/admin/gate { personalCode } — 관리자 계정이면 확인 쿠키를 준다.
async function handleGate(request, env) {
  if (!(await loginAllowed(env, request))) return json({ error: 'too many requests, try again later' }, 429);
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var code = typeof body.personalCode === 'string' ? body.personalCode.trim() : '';
  var accountHash = PERSONAL_CODE_RE.test(code) ? await sha256Hex('user-v2:' + code) : '';
  if (!adminHashes(env).some(function (h) { return safeEqual(h, accountHash); })) {
    return json({ error: 'forbidden' }, 403);
  }
  var token = await signToken(env, { k: 'gate', a: accountHash.slice(0, ACTOR_LENGTH), e: Date.now() + GATE_TTL_S * 1000 });
  var res = json({ ok: true });
  res.headers.set('Set-Cookie', gateCookie(token, GATE_TTL_S));
  return res;
}

// POST /api/admin/gate/clear — 관리 페이지에서 로그아웃할 때 확인 쿠키를 지운다.
function handleGateClear() {
  var res = json({ ok: true });
  res.headers.set('Set-Cookie', gateCookie('', 0));
  return res;
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
}, gameRoutes, tagRoutes, bumpRoutes, libraryRoutes, officialTagRoutes);

export default {
  async fetch(request, env, ctx) {
    if (!configured(env)) return json({ error: 'admin is not configured' }, 503);
    var url = new URL(request.url);
    var path = url.pathname.slice('/api/admin'.length);
    try {
      if (path === '/login' && request.method === 'POST') return await handleLogin(request, env);
      if (path === '/gate' && request.method === 'POST') return await handleGate(request, env);
      if (path === '/gate/clear' && request.method === 'POST') return handleGateClear();
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
