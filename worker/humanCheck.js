/**
 * humanCheck — 방문 통계에 "사람만" 남기기 위한 Turnstile 검증.
 * src/_worker.js의 POST /api/pageview 가 이 모듈을 쓴다.
 *
 * 왜 필요한가:
 * - 예전엔 HTML 문서 요청마다 서버에서 바로 방문을 기록했다. 그러면 JS를
 *   아예 안 돌리는 스캐너 봇(/TikTok/TikTok.html, /app_cn/ 같은 경로를
 *   훑고 다니는 것들)도 전부 방문자로 잡혔다. 지금은 브라우저가 로딩 중에
 *   비콘을 보내야만 기록되고, 그 비콘도 Turnstile을 한 번 통과한 브라우저만
 *   인정한다.
 *
 * 흐름:
 * - Turnstile 토큰은 1회용이라 페이지마다 새로 받을 수 없다. 그래서 한 번
 *   통과하면 서명한 쿠키(cpkg_hv, 30일)를 내려주고, 이후 비콘은 쿠키만
 *   확인한다. 쿠키 서명 키는 TURNSTILE_SECRET을 그대로 쓴다 — 서버 밖으로
 *   나가지 않는 값이라 별도 시크릿을 늘릴 이유가 없다.
 * - TURNSTILE_SITEKEY(vars) / TURNSTILE_SECRET(시크릿) 중 하나라도 없으면
 *   isConfigured()가 false다. 그땐 검증을 건너뛰고 비콘만으로 기록한다 —
 *   그래도 JS를 안 돌리는 봇은 이미 빠진다.
 */

var COOKIE_NAME = 'cpkg_hv';
var COOKIE_TTL_S = 30 * 86400;
var SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
var EXPECTED_ACTION = 'pageview';

export function isConfigured(env) {
  return !!(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET);
}

async function hmacHex(secret, message) {
  var key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  var sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function readCookie(request, name) {
  var header = request.headers.get('Cookie') || '';
  var parts = header.split(';');
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    if (parts[i].slice(0, eq).trim() === name) return parts[i].slice(eq + 1).trim();
  }
  return '';
}

// 쿠키 값은 "<만료 epoch 초>.<HMAC hex>". 만료를 서명에 넣어 두어야
// 누가 숫자만 늘려서 영구 쿠키로 바꾸지 못한다.
export async function hasValidPass(request, env) {
  var raw = readCookie(request, COOKIE_NAME);
  var m = /^(\d{10})\.([a-f0-9]{64})$/.exec(raw);
  if (!m) return false;
  if (Number(m[1]) * 1000 < Date.now()) return false;
  var expected = await hmacHex(env.TURNSTILE_SECRET, 'hv|' + m[1]);
  // 길이가 같은 hex끼리의 비교라 조기 반환 타이밍 차이를 없앤다.
  var diff = 0;
  for (var i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}

export async function passCookie(env) {
  var exp = Math.floor(Date.now() / 1000) + COOKIE_TTL_S;
  var sig = await hmacHex(env.TURNSTILE_SECRET, 'hv|' + exp);
  return COOKIE_NAME + '=' + exp + '.' + sig +
    '; Path=/; Max-Age=' + COOKIE_TTL_S + '; HttpOnly; Secure; SameSite=Lax';
}

// siteverify는 네트워크 오류·비정상 응답이면 무조건 실패로 본다(fail closed).
// hostname은 이 비콘을 받은 Worker 자신의 호스트와 같아야 한다 — 비콘이
// 같은 오리진에서만 오므로, 배포마다 허용 목록을 따로 관리하지 않아도
// cpkg.cloud / cpkg-dev / localhost가 각자 자기 호스트만 인정하게 된다.
export async function verifyToken(token, request, env) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;
  var result;
  try {
    var res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || ''
      })
    });
    if (!res.ok) return false;
    result = await res.json();
  } catch (e) {
    return false;
  }
  return !!(result && result.success === true &&
    result.action === EXPECTED_ACTION &&
    result.hostname === new URL(request.url).hostname);
}
