// 관리 페이지 프로필 탭(설계: docs/superpowers/specs/2026-10-07-user-profile-design.md 3절).
//   GET  /profiles?q=               최근 수정 50개, q 가 있으면 닉네임 부분 일치 50개
//   POST /profiles/reset-nickname   {id} 닉네임을 `유저` + 공개 ID 앞 6자로, 변경 간격 제한 해제
//   POST /profiles/clear-bio        {id}
//   POST /profiles/delete           {id}
//   POST /profiles/delete-account   {id} 계정 삭제(프로필·서재·랭킹 줄 + 삭제 표식)
// 바꾸는 작업은 같은 batch 로 admin_actions 에 남기고 detail.before 에 바뀌기 전 행을 담는다.
import { json, readBody, logAction } from './adminCommon.js';
import { nicknameKey, gameHashFor } from './profileApi.js';
import { purgeByProfile } from './accountDelete.js';

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

function updateWithLog(env, session, action, row, sql, args, extra) {
  var statement = env.TAGS_DB.prepare(sql);
  return env.TAGS_DB.batch([statement.bind.apply(statement, args)].concat(extra || [], [
    logAction(env, session.actor, action, row.profile_id, { before: row })
  ]));
}

// 프로필로 등록한 랭킹 줄(유저 프로필 2단계)에 저장된 닉네임도 함께 바꾼다. 프로필이
// 지워지면 그 줄은 이 글자로만 보이므로, 정리한 닉네임이 순위표에 남지 않게 한다.
async function rankingRename(env, profileId, nickname) {
  return env.TAGS_DB.prepare('UPDATE game_scores SET nickname = ? WHERE player_hash = ?')
    .bind(nickname, await gameHashFor(profileId));
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
        [candidates[i], nicknameKey(candidates[i]), now, row.profile_id],
        [await rankingRename(env, row.profile_id, candidates[i])]);
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

// 연결 행(profile_links)도 함께 지우고 기록에 남긴다. 연결 테이블이 없으면 프로필만 지운다.
async function handleDelete(request, env, ctx, session) {
  var row = await readTarget(request, env);
  if (row instanceof Response) return row;
  var link = null;
  try {
    link = await env.TAGS_DB.prepare('SELECT * FROM profile_links WHERE profile_id = ?').bind(row.profile_id).first();
  } catch (e) {}
  var statements = [env.TAGS_DB.prepare('DELETE FROM profiles WHERE profile_id = ?').bind(row.profile_id)];
  if (link) statements.push(env.TAGS_DB.prepare('DELETE FROM profile_links WHERE profile_id = ?').bind(row.profile_id));
  statements.push(await rankingRename(env, row.profile_id, '유저' + row.profile_id.slice(0, 6)));
  statements.push(logAction(env, session.actor, 'profile.delete', row.profile_id, { before: row, link: link }));
  await env.TAGS_DB.batch(statements);
  return json({ ok: true });
}

// 계정 삭제: 프로필에서 닿는 데이터를 지우고 삭제 표식(pending)을 남긴다. 계정 본체는 그 코드의
// 다음 요청이 마저 지운다. R2 와 D1 은 한 트랜잭션이 아니라서, 지운 뒤 기록이 실패하면 warning 을 싣는다.
async function handleDeleteAccount(request, env, ctx, session) {
  var row = await readTarget(request, env);
  if (row instanceof Response) return row;
  var result;
  try {
    result = await purgeByProfile(env, row);
  } catch (e) {
    console.error('account delete failed', e && e.message);
    return json({ error: 'account delete unavailable' }, 503);
  }
  try {
    await logAction(env, session.actor, 'profile.delete-account', row.profile_id,
      { before: row, link: result.link, libraryCodes: result.libraryCodes }).run();
  } catch (e) {
    return json({ ok: true, warning: 'deleted, but the action log could not be written' });
  }
  return json({ ok: true });
}

export var profileRoutes = {
  'GET /profiles': handleList,
  'POST /profiles/reset-nickname': handleResetNickname,
  'POST /profiles/clear-bio': handleClearBio,
  'POST /profiles/delete': handleDelete,
  'POST /profiles/delete-account': handleDeleteAccount
};
