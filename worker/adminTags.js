import { json, readBody, logAction, intParam } from './adminCommon.js';
import { recordTagSnapshot } from './tagSnapshot.js';

// 관리 페이지의 태그 투표 탭(worker/tags_schema.sql). 투표자는 기능 전용 해시
// voter_hash(sha256('tagvote:' + personalCode))로만 구분되므로, 한 사람이 몰아서
// 넣은 표는 이 해시 단위로 지울 수 있다. 공개 투표 쪽 잠금 확인은
// favoritesShareWorker.js 의 tagVoteLocked. 표를 바꾼 뒤에는 5분 Cron 을 기다리지
// 않고 목록 화면이 읽는 스냅샷(tags/snapshot.json)을 바로 다시 굽는다.

var RECENT_DEFAULT = 50;
var RECENT_MAX = 200;
var PREFIX_RE = /^[0-9a-f]{8,64}$/;
var SHORT = 8;

function refreshSnapshot(env, ctx) {
  ctx.waitUntil(recordTagSnapshot(env));
}

async function isLocked(env, postId) {
  return !!(await env.TAGS_DB.prepare('SELECT 1 FROM tag_vote_locks WHERE post_id = ?').bind(postId).first());
}

// GET tags/post?postId= — 태그별 득표 수와 잠금 여부.
async function handlePost(request, env, ctx, session, url) {
  var postId = intParam(url.searchParams.get('postId'));
  if (!postId) return json({ error: 'invalid payload shape' }, 400);
  var rows = (await env.TAGS_DB.prepare(
    'SELECT tag_name, COUNT(*) AS votes FROM tag_votes WHERE post_id = ? GROUP BY tag_name ORDER BY votes DESC'
  ).bind(postId).all()).results || [];
  var votes = {};
  rows.forEach(function (r) { votes[r.tag_name] = r.votes; });
  return json({ postId: postId, locked: await isLocked(env, postId), votes: votes });
}

// GET tags/recent?limit= — 최근 투표. 투표자는 해시 앞 8자만 보여준다.
async function handleRecent(request, env, ctx, session, url) {
  var limit = Math.min(intParam(url.searchParams.get('limit')) || RECENT_DEFAULT, RECENT_MAX);
  var rows = (await env.TAGS_DB.prepare(
    'SELECT post_id, tag_name, voter_hash, created_at FROM tag_votes ORDER BY created_at DESC LIMIT ?'
  ).bind(limit).all()).results || [];
  return json({
    items: rows.map(function (r) {
      return { postId: r.post_id, tagName: r.tag_name, voter: r.voter_hash.slice(0, SHORT), createdAt: r.created_at };
    })
  });
}

// POST tags/reset { postId, tagName? } — 작품×태그(또는 작품 전체) 투표 삭제.
async function handleReset(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var postId = intParam(body.postId);
  var tagName = body.tagName == null ? null : (typeof body.tagName === 'string' && body.tagName ? body.tagName : undefined);
  if (!postId || tagName === undefined) return json({ error: 'invalid payload shape' }, 400);
  var where = 'WHERE post_id = ?' + (tagName ? ' AND tag_name = ?' : '');
  var args = tagName ? [postId, tagName] : [postId];
  var select = env.TAGS_DB.prepare('SELECT post_id, tag_name, voter_hash, created_at FROM tag_votes ' + where);
  var rows = (await select.bind.apply(select, args).all()).results || [];
  if (!rows.length) return json({ error: 'not found' }, 404);
  var del = env.TAGS_DB.prepare('DELETE FROM tag_votes ' + where);
  await env.TAGS_DB.batch([
    del.bind.apply(del, args),
    logAction(env, session.actor, 'tags.reset', postId + (tagName ? ' · ' + tagName : ''), { postId: postId, tagName: tagName, rows: rows })
  ]);
  refreshSnapshot(env, ctx);
  return json({ ok: true, deleted: rows.length });
}

// POST tags/purge-voter { voterPrefix } — 접두사가 정확히 한 투표자에게만 맞을 때만 지운다.
async function handlePurgeVoter(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var prefix = typeof body.voterPrefix === 'string' ? body.voterPrefix.trim().toLowerCase() : '';
  if (!PREFIX_RE.test(prefix)) return json({ error: 'invalid payload shape' }, 400);
  var voters = (await env.TAGS_DB.prepare(
    'SELECT DISTINCT voter_hash FROM tag_votes WHERE substr(voter_hash, 1, ?) = ? LIMIT 2'
  ).bind(prefix.length, prefix).all()).results || [];
  if (!voters.length) return json({ error: 'not found' }, 404);
  if (voters.length > 1) return json({ error: 'ambiguous voter' }, 409);
  var voterHash = voters[0].voter_hash;
  var rows = (await env.TAGS_DB.prepare(
    'SELECT post_id, tag_name, voter_hash, created_at FROM tag_votes WHERE voter_hash = ?'
  ).bind(voterHash).all()).results || [];
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('DELETE FROM tag_votes WHERE voter_hash = ?').bind(voterHash),
    logAction(env, session.actor, 'tags.purge-voter', voterHash.slice(0, SHORT), { voterHash: voterHash, rows: rows })
  ]);
  refreshSnapshot(env, ctx);
  return json({ ok: true, deleted: rows.length });
}

async function handleLock(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var postId = intParam(body.postId);
  if (!postId) return json({ error: 'invalid payload shape' }, 400);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('INSERT OR IGNORE INTO tag_vote_locks (post_id, locked_at) VALUES (?, ?)').bind(postId, Date.now()),
    logAction(env, session.actor, 'tags.lock', postId, null)
  ]);
  return json({ ok: true });
}

async function handleUnlock(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var postId = intParam(body.postId);
  if (!postId) return json({ error: 'invalid payload shape' }, 400);
  if (!(await isLocked(env, postId))) return json({ error: 'not found' }, 404);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('DELETE FROM tag_vote_locks WHERE post_id = ?').bind(postId),
    logAction(env, session.actor, 'tags.unlock', postId, null)
  ]);
  return json({ ok: true });
}

export var tagRoutes = {
  'GET /tags/post': handlePost,
  'GET /tags/recent': handleRecent,
  'POST /tags/reset': handleReset,
  'POST /tags/purge-voter': handlePurgeVoter,
  'POST /tags/lock': handleLock,
  'POST /tags/unlock': handleUnlock
};
