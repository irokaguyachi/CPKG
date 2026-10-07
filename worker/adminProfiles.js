// 관리 페이지 프로필 탭(설계: docs/superpowers/specs/2026-10-07-user-profile-design.md 3절).
//   GET  /profiles?q=               최근 수정 50개, q 가 있으면 닉네임 부분 일치 50개
//   POST /profiles/reset-nickname   {id} 닉네임을 `유저` + 공개 ID 앞 6자로, 변경 간격 제한 해제
//   POST /profiles/clear-bio        {id}
//   POST /profiles/delete           {id}
// 바꾸는 작업은 같은 batch 로 admin_actions 에 남기고 detail.before 에 바뀌기 전 행을 담는다.
import { json, readBody, logAction } from './adminCommon.js';
import { nicknameKey } from './profileApi.js';

var LIST_LIMIT = 50;
var QUERY_MAX = 40;
var PROFILE_ID_RE = /^[A-Za-z0-9_-]{12}$/;

function listItem(row) {
  return {
    id: row.profile_id, nickname: row.nickname, icon: row.icon, color: row.color, bio: row.bio,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

async function handleList(request, env, ctx, session, url) {
  var q = nicknameKey((url.searchParams.get('q') || '').trim().slice(0, QUERY_MAX));
  var statement = q
    ? env.TAGS_DB.prepare(
      "SELECT * FROM profiles WHERE nickname_key LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?"
    ).bind('%' + escapeLike(q) + '%', LIST_LIMIT)
    : env.TAGS_DB.prepare('SELECT * FROM profiles ORDER BY updated_at DESC LIMIT ?').bind(LIST_LIMIT);
  var rows = (await statement.all()).results || [];
  return json({ items: rows.map(listItem) });
}

// 본문의 id 로 프로필 행을 읽는다. 잘못된 요청이면 Response 를 돌려준다.
async function readTarget(request, env) {
  var body = await readBody(request);
  if (body instanceof Response) return body;
  if (typeof body.id !== 'string' || !PROFILE_ID_RE.test(body.id)) return json({ error: 'invalid payload shape' }, 400);
  var row = await env.TAGS_DB.prepare('SELECT * FROM profiles WHERE profile_id = ?').bind(body.id).first();
  if (!row) return json({ error: 'not found' }, 404);
  return row;
}

function updateWithLog(env, session, action, row, sql, args) {
  var statement = env.TAGS_DB.prepare(sql);
  return env.TAGS_DB.batch([
    statement.bind.apply(statement, args),
    logAction(env, session.actor, action, row.profile_id, { before: row })
  ]);
}

async function handleResetNickname(request, env, ctx, session) {
  var row = await readTarget(request, env);
  if (row instanceof Response) return row;
  var now = Date.now();
  // 앞 6자가 다른 초기화 이름과 대소문자 무시로 겹치면 전체 ID 를 쓴다(공개 ID 는 유일하다).
  var candidates = ['유저' + row.profile_id.slice(0, 6), '유저' + row.profile_id];
  for (var i = 0; i < candidates.length; i++) {
    try {
      await updateWithLog(env, session, 'profile.reset-nickname', row,
        'UPDATE profiles SET nickname = ?, nickname_key = ?, nickname_changed_at = 0, updated_at = ? WHERE profile_id = ?',
        [candidates[i], nicknameKey(candidates[i]), now, row.profile_id]);
      return json({ ok: true, profile: listItem(Object.assign({}, row, { nickname: candidates[i], updated_at: now })) });
    } catch (e) {
      if (String(e && e.message || '').indexOf('UNIQUE') === -1 || i === candidates.length - 1) throw e;
    }
  }
}

async function handleClearBio(request, env, ctx, session) {
  var row = await readTarget(request, env);
  if (row instanceof Response) return row;
  var now = Date.now();
  await updateWithLog(env, session, 'profile.clear-bio', row,
    "UPDATE profiles SET bio = '', updated_at = ? WHERE profile_id = ?", [now, row.profile_id]);
  return json({ ok: true, profile: listItem(Object.assign({}, row, { bio: '', updated_at: now })) });
}

async function handleDelete(request, env, ctx, session) {
  var row = await readTarget(request, env);
  if (row instanceof Response) return row;
  await updateWithLog(env, session, 'profile.delete', row,
    'DELETE FROM profiles WHERE profile_id = ?', [row.profile_id]);
  return json({ ok: true });
}

export var profileRoutes = {
  'GET /profiles': handleList,
  'POST /profiles/reset-nickname': handleResetNickname,
  'POST /profiles/clear-bio': handleClearBio,
  'POST /profiles/delete': handleDelete
};
