import { json, readBody, logAction, intParam } from './adminCommon.js';

// 관리 페이지의 끌올 탭(worker/bump_schema.sql). 끌올은 줄서기 큐라서 "지금
// 활성" = 이미 시작한 행 중 가장 늦게 시작한 행이다(favoritesShareWorker.js 의
// BUMP_ACTIVE_ID_SQL 과 같은 판정). 그래서 취소 방식이 행의 상태마다 다르다.
// - 대기 중(start_at > 지금): 행을 지운다.
// - 활성: 지우면 이미 교체된 이전 끌올이 되살아나므로 bump_cancels 에 표시하고,
//   가장 이른 대기 행을 지금 시작으로 당긴다. 공개 쪽은 표시된 활성 행을 숨긴다.
// - 이미 끝난 행: 취소할 수 없다.

var HISTORY_MS = 7 * 86400000;
var ACTIVE_ID_SQL = '(SELECT id FROM bumps WHERE start_at <= ? ORDER BY start_at DESC, id DESC LIMIT 1)';

async function activeId(env, now) {
  var row = await env.TAGS_DB.prepare('SELECT ' + ACTIVE_ID_SQL + ' AS id').bind(now).first();
  return row ? row.id : null;
}

// GET bumps — 대기 중 + 최근 7일. 신청자는 해시 앞 8자만, 제목은 화면이 Lookup.json 으로 채운다.
async function handleList(request, env) {
  var now = Date.now();
  var current = await activeId(env, now);
  var rows = (await env.TAGS_DB.prepare(
    'SELECT b.id, b.item_type, b.item_id, b.requester_hash, b.requested_at, b.start_at, b.end_at, ' +
    'c.bump_id IS NOT NULL AS cancelled FROM bumps b LEFT JOIN bump_cancels c ON c.bump_id = b.id ' +
    'WHERE b.start_at > ? ORDER BY b.start_at DESC, b.id DESC'
  ).bind(now - HISTORY_MS).all()).results || [];
  return json({
    now: now,
    items: rows.map(function (r) {
      var state = r.start_at > now ? 'waiting' : (r.id === current && !r.cancelled ? 'active' : 'done');
      return {
        id: r.id, itemType: r.item_type, itemId: r.item_id, requester: r.requester_hash.slice(0, 8),
        requestedAt: r.requested_at, startAt: r.start_at, endAt: r.end_at, state: state, cancelled: !!r.cancelled
      };
    })
  });
}

// POST bumps/cancel { id }
async function handleCancel(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var id = intParam(body.id);
  if (!id) return json({ error: 'invalid payload shape' }, 400);
  var now = Date.now();
  var row = await env.TAGS_DB.prepare('SELECT * FROM bumps WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'not found' }, 404);
  var target = row.item_type + ' ' + row.item_id;

  if (row.start_at > now) {
    await env.TAGS_DB.batch([
      env.TAGS_DB.prepare('DELETE FROM bumps WHERE id = ?').bind(id),
      logAction(env, session.actor, 'bump.cancel', target, { state: 'waiting', row: row })
    ]);
    return json({ ok: true });
  }

  var cancelled = await env.TAGS_DB.prepare('SELECT 1 FROM bump_cancels WHERE bump_id = ?').bind(id).first();
  if (id !== await activeId(env, now) || cancelled) return json({ error: 'not cancellable' }, 400);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('INSERT INTO bump_cancels (bump_id, cancelled_at) VALUES (?, ?)').bind(id, now),
    env.TAGS_DB.prepare('UPDATE bumps SET end_at = ? WHERE id = ?').bind(now, id),
    env.TAGS_DB.prepare(
      'UPDATE bumps SET start_at = ? WHERE id = (SELECT id FROM bumps WHERE start_at > ? ORDER BY start_at ASC, id ASC LIMIT 1)'
    ).bind(now, now),
    logAction(env, session.actor, 'bump.cancel', target, { state: 'active', row: row })
  ]);
  return json({ ok: true });
}

export var bumpRoutes = {
  'GET /bumps': handleList,
  'POST /bumps/cancel': handleCancel
};
