import { readJsonLimited } from './requestBody.js';

// 관리 API(worker/adminApi.js)와 기능별 관리 모듈(adminGame.js 등)이 함께 쓰는
// 응답·본문·작업 기록 도우미. adminApi.js 가 기능 모듈을 import 하므로, 기능
// 모듈이 adminApi.js 를 다시 import 하는 순환을 피하려고 여기에 따로 둔다.

var ADMIN_MAX_BODY_BYTES = 4096;

// 관리 응답은 캐시하지 않고, CORS 헤더도 붙이지 않는다 — 같은 출처의
// /admin 페이지만 읽을 수 있다.
export function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// 본문이 객체가 아니면 400 응답을 돌려준다. 호출부는 `instanceof Response` 로 거른다.
export async function readBody(request) {
  var parsed = await readJsonLimited(request, ADMIN_MAX_BODY_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    return json({ error: 'invalid payload shape' }, 400);
  }
  return parsed.value;
}

// 실제 변경과 같은 D1 batch 에 끼워 넣을 작업 기록 문장. 따로 실행하면 "지워졌는데
// 기록이 없는" 상태가 생길 수 있어서 문장만 만들어 돌려준다.
export function logAction(env, actor, action, target, detail) {
  return env.TAGS_DB.prepare(
    'INSERT INTO admin_actions (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)'
  ).bind(Date.now(), actor, action, String(target), detail === undefined || detail === null ? null : JSON.stringify(detail));
}

export function intParam(raw) {
  var n = typeof raw === 'number' ? raw : parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}
