import { json, readBody, logAction } from './adminCommon.js';
import { cleanGameNickname, gameWeekKey } from './favoritesShareWorker.js';

// 관리 페이지의 랭킹 탭(우주 미니게임, worker/game_schema.sql). 플레이어는
// game_scores.player_hash(sha256('spacegame:' + playerId))로만 구분된다 —
// 브라우저 단위라서 차단은 저장소를 지우면 피할 수 있고, 금지 닉네임 목록이
// 그 보완책이다. 공개 등록 쪽 확인은 favoritesShareWorker.js 의 gameSubmitBlocked.

var SCORES_LIMIT = 100;
var HASH_RE = /^[0-9a-f]{64}$/;
var PERIOD_RE = /^(all|w\d{4}-\d{2}-\d{2})$/;
var WORD_MAX = 20;

function cleanHash(raw) {
  return typeof raw === 'string' && HASH_RE.test(raw) ? raw : null;
}

function cleanWord(raw) {
  if (typeof raw !== 'string') return null;
  var word = raw.normalize('NFC').trim().toLowerCase();
  var length = Array.from(word).length;
  return length >= 1 && length <= WORD_MAX ? word : null;
}

async function playerRows(env, hash, period) {
  var sql = 'SELECT period, player_hash, nickname, score_ms, achieved_at FROM game_scores WHERE player_hash = ?';
  var stmt = period
    ? env.TAGS_DB.prepare(sql + ' AND period = ?').bind(hash, period)
    : env.TAGS_DB.prepare(sql).bind(hash);
  return (await stmt.all()).results || [];
}

// GET game/scores?period=all|weekly — 상위 100명. weekly 는 이번 주(한국 시간 월요일 기준).
async function handleScores(request, env, ctx, session, url) {
  var period = url.searchParams.get('period') === 'weekly' ? gameWeekKey(Date.now()) : 'all';
  var rows = (await env.TAGS_DB.prepare(
    'SELECT s.player_hash, s.nickname, s.score_ms, s.achieved_at, b.player_hash IS NOT NULL AS banned ' +
    'FROM game_scores s LEFT JOIN game_bans b ON b.player_hash = s.player_hash ' +
    'WHERE s.period = ? ORDER BY s.score_ms DESC, s.achieved_at ASC LIMIT ?'
  ).bind(period, SCORES_LIMIT).all()).results || [];
  return json({
    period: period,
    items: rows.map(function (r) {
      return {
        playerHash: r.player_hash, playerShort: r.player_hash.slice(0, 8), nickname: r.nickname,
        scoreMs: r.score_ms, achievedAt: r.achieved_at, banned: !!r.banned
      };
    })
  });
}

// POST game/delete { playerHash, scope:'period'|'all', period? }
async function handleDelete(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var hash = cleanHash(body.playerHash);
  var byPeriod = body.scope === 'period';
  if (!hash || (!byPeriod && body.scope !== 'all') || (byPeriod && !PERIOD_RE.test(String(body.period)))) {
    return json({ error: 'invalid payload shape' }, 400);
  }
  var rows = await playerRows(env, hash, byPeriod ? body.period : null);
  if (!rows.length) return json({ error: 'not found' }, 404);
  var del = byPeriod
    ? env.TAGS_DB.prepare('DELETE FROM game_scores WHERE player_hash = ? AND period = ?').bind(hash, body.period)
    : env.TAGS_DB.prepare('DELETE FROM game_scores WHERE player_hash = ?').bind(hash);
  await env.TAGS_DB.batch([del, logAction(env, session.actor, 'game.delete', rows[0].nickname, { scope: body.scope, rows: rows })]);
  return json({ ok: true, deleted: rows.length });
}

// POST game/rename { playerHash, nickname } — 모든 기간의 닉네임을 바꾼다.
async function handleRename(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var hash = cleanHash(body.playerHash);
  var nickname = cleanGameNickname(body.nickname);
  if (!hash || nickname === null) return json({ error: 'invalid payload shape' }, 400);
  var rows = await playerRows(env, hash, 'all');
  if (!rows.length) return json({ error: 'not found' }, 404);
  var taken = await env.TAGS_DB.prepare(
    "SELECT 1 FROM game_scores WHERE period = 'all' AND nickname = ? COLLATE NOCASE AND player_hash <> ? LIMIT 1"
  ).bind(nickname, hash).first();
  if (taken) return json({ error: 'nickname taken' }, 409);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('UPDATE game_scores SET nickname = ? WHERE player_hash = ?').bind(nickname, hash),
    logAction(env, session.actor, 'game.rename', rows[0].nickname, { playerHash: hash, from: rows[0].nickname, to: nickname })
  ]);
  return json({ ok: true });
}

// POST game/ban { playerHash, reason? } — 모든 기록을 지우고 이후 등록을 막는다.
async function handleBan(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var hash = cleanHash(body.playerHash);
  if (!hash) return json({ error: 'invalid payload shape' }, 400);
  var reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
  var rows = await playerRows(env, hash, null);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare(
      'INSERT INTO game_bans (player_hash, reason, banned_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(player_hash) DO UPDATE SET reason = excluded.reason'
    ).bind(hash, reason || null, Date.now()),
    env.TAGS_DB.prepare('DELETE FROM game_scores WHERE player_hash = ?').bind(hash),
    logAction(env, session.actor, 'game.ban', rows.length ? rows[0].nickname : hash.slice(0, 8), { playerHash: hash, reason: reason, rows: rows })
  ]);
  return json({ ok: true, deleted: rows.length });
}

async function handleUnban(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var hash = cleanHash(body.playerHash);
  if (!hash) return json({ error: 'invalid payload shape' }, 400);
  var ban = await env.TAGS_DB.prepare('SELECT player_hash, reason, banned_at FROM game_bans WHERE player_hash = ?').bind(hash).first();
  if (!ban) return json({ error: 'not found' }, 404);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('DELETE FROM game_bans WHERE player_hash = ?').bind(hash),
    logAction(env, session.actor, 'game.unban', hash.slice(0, 8), ban)
  ]);
  return json({ ok: true });
}

// 차단 목록과 금지어 목록을 함께 준다(랭킹 탭 아래 관리 영역).
async function handleNicknames(request, env) {
  var results = await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('SELECT word, added_at FROM banned_nicknames ORDER BY added_at DESC'),
    env.TAGS_DB.prepare('SELECT player_hash, reason, banned_at FROM game_bans ORDER BY banned_at DESC')
  ]);
  return json({
    items: (results[0].results || []).map(function (r) { return { word: r.word, addedAt: r.added_at }; }),
    bans: (results[1].results || []).map(function (r) {
      return { playerHash: r.player_hash, playerShort: r.player_hash.slice(0, 8), reason: r.reason, bannedAt: r.banned_at };
    })
  });
}

async function handleNicknameAdd(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var word = cleanWord(body.word);
  if (!word) return json({ error: 'invalid payload shape' }, 400);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('INSERT OR IGNORE INTO banned_nicknames (word, added_at) VALUES (?, ?)').bind(word, Date.now()),
    logAction(env, session.actor, 'game.nickname.add', word, null)
  ]);
  return json({ ok: true, word: word });
}

async function handleNicknameRemove(request, env, ctx, session) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  var word = cleanWord(body.word);
  if (!word) return json({ error: 'invalid payload shape' }, 400);
  var exists = await env.TAGS_DB.prepare('SELECT 1 FROM banned_nicknames WHERE word = ?').bind(word).first();
  if (!exists) return json({ error: 'not found' }, 404);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('DELETE FROM banned_nicknames WHERE word = ?').bind(word),
    logAction(env, session.actor, 'game.nickname.remove', word, null)
  ]);
  return json({ ok: true });
}

export var gameRoutes = {
  'GET /game/scores': handleScores,
  'POST /game/delete': handleDelete,
  'POST /game/rename': handleRename,
  'POST /game/ban': handleBan,
  'POST /game/unban': handleUnban,
  'GET /game/nicknames': handleNicknames,
  'POST /game/nicknames/add': handleNicknameAdd,
  'POST /game/nicknames/remove': handleNicknameRemove
};
