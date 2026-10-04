import { json, readBody, logAction } from './adminCommon.js';
import { readLibraryIndex, updateLibraryIndex } from './libraryIndex.js';

// 관리 페이지의 공개 서재 탭. 공개 서재는 R2 library/<code>.json 이고, 목록은
// libraryIndex.js 의 공개 인덱스를 쓴다. 숨김은 D1 library_hidden 에 두고 공개
// 목록·조회(favoritesShareWorker.js 의 hiddenLibraryCodes / isLibraryHidden)가
// 걸러낸다 — R2 레코드를 고치지 않으므로 주인이 수정해도 숨김이 풀리지 않는다.

var CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
var LIST_LIMIT = 200;
var QUERY_MAX = 50;

function cleanCode(raw) {
  return typeof raw === 'string' && CODE_RE.test(raw) ? raw : null;
}

// 작업 기록에 남길 원본 — 인증 해시는 복구에 필요 없고 남길 이유도 없어서 뺀다.
function recordSnapshot(record) {
  var copy = Object.assign({}, record);
  delete copy.editTokenHash;
  delete copy.ownerHash;
  return copy;
}

// GET library?q= — 이름·코드 부분 일치, 최신순 200건 + 숨긴 서재 목록.
async function handleList(request, env, ctx, session, url) {
  var rows = await readLibraryIndex(env);
  if (!Array.isArray(rows)) return json({ error: 'library index is preparing, try again shortly' }, 503);
  var hiddenRows = (await env.TAGS_DB.prepare(
    'SELECT code, name, hidden_at FROM library_hidden ORDER BY hidden_at DESC'
  ).all()).results || [];
  var hidden = new Set(hiddenRows.map(function (r) { return r.code; }));
  var q = (url.searchParams.get('q') || '').trim().slice(0, QUERY_MAX).toLowerCase();
  var items = rows
    .filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) !== -1 || r.code.toLowerCase().indexOf(q) !== -1; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; })
    .slice(0, LIST_LIMIT)
    .map(function (r) { return Object.assign({}, r, { hidden: hidden.has(r.code) }); });
  return json({
    items: items,
    total: rows.length,
    hidden: hiddenRows.map(function (r) { return { code: r.code, name: r.name, hiddenAt: r.hidden_at }; })
  });
}

async function handleHide(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var code = cleanCode(body.code);
  if (!code) return json({ error: 'invalid payload shape' }, 400);
  var object = await env.FAVORITES_BUCKET.get('library/' + code + '.json');
  if (!object) return json({ error: 'not found' }, 404);
  var record = await object.json();
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare(
      'INSERT INTO library_hidden (code, name, hidden_at) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING'
    ).bind(code, record.name || '', Date.now()),
    logAction(env, session.actor, 'library.hide', code, { name: record.name })
  ]);
  return json({ ok: true });
}

async function handleUnhide(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var code = cleanCode(body.code);
  if (!code) return json({ error: 'invalid payload shape' }, 400);
  var row = await env.TAGS_DB.prepare('SELECT code, name FROM library_hidden WHERE code = ?').bind(code).first();
  if (!row) return json({ error: 'not found' }, 404);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('DELETE FROM library_hidden WHERE code = ?').bind(code),
    logAction(env, session.actor, 'library.unhide', code, { name: row.name })
  ]);
  return json({ ok: true });
}

// POST library/delete { code } — R2 원본과 공개 인덱스에서 지운다. R2 와 D1 은 한
// 트랜잭션으로 묶을 수 없어서, R2 삭제가 끝난 뒤 기록을 남기고 기록이 실패하면
// 응답에 warning 을 싣는다(주인의 owners/ 인덱스 잔여 항목은 owner/lookup 이 정리한다).
async function handleDelete(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var code = cleanCode(body.code);
  if (!code) return json({ error: 'invalid payload shape' }, 400);
  var key = 'library/' + code + '.json';
  var object = await env.FAVORITES_BUCKET.get(key);
  if (!object) return json({ error: 'not found' }, 404);
  var record = await object.json();

  await env.FAVORITES_BUCKET.delete(key);
  await updateLibraryIndex(env, code, null);
  try {
    await env.TAGS_DB.batch([
      env.TAGS_DB.prepare('DELETE FROM library_hidden WHERE code = ?').bind(code),
      logAction(env, session.actor, 'library.delete', code, { record: recordSnapshot(record) })
    ]);
  } catch (e) {
    return json({ ok: true, warning: 'deleted, but the action log could not be written' });
  }
  return json({ ok: true });
}

export var libraryRoutes = {
  'GET /library': handleList,
  'POST /library/hide': handleHide,
  'POST /library/unhide': handleUnhide,
  'POST /library/delete': handleDelete
};
