// 계정 삭제. 코드를 아는 쪽(사용자 본인)이 한 번에 지운다.
// 모든 단계가 멱등이라 중간에 실패해도 다시 부르면 이어서 끝난다.
// 표식(deleted_accounts)을 가장 먼저 남겨, 이후 단계가 실패해도 계정이 되살아나지 않게 한다.
// 설계: docs/superpowers/specs/2026-10-16-account-delete-design.md
import { userStoreKey, ownerIndexKey, ownerHashFor, profileOwnerHash } from './accountKeys.js';
import { gameHashFor } from './profileApi.js';
import { updateLibraryIndex, readLibraryIndex } from './libraryIndex.js';

// 삭제 표식을 찾는다. 없거나(테이블 없음·D1 오류 포함) 못 읽으면 null.
export async function checkDeleted(env, personalCode) {
  try {
    var row = await env.TAGS_DB.prepare('SELECT pending FROM deleted_accounts WHERE owner_hash = ?')
      .bind(await profileOwnerHash(personalCode)).first();
    return row ? { pending: !!row.pending } : null;
  } catch (e) {
    return null;
  }
}

// 서재 한 개를 지운다: R2 원본 + 공개 목록 색인 + 숨김 행.
export async function deleteLibraryRecord(env, code) {
  await env.FAVORITES_BUCKET.delete('library/' + code + '.json');
  await updateLibraryIndex(env, code, null);
  try {
    await env.TAGS_DB.prepare('DELETE FROM library_hidden WHERE code = ?').bind(code).run();
  } catch (e) {
    // 숨김 테이블이 없거나 D1 오류여도 서재 삭제 자체는 끝난 것으로 본다
  }
}

// 소유 색인에 걸린 서재 중 주인이 맞는 것만 지우고, 소유 색인을 지운다.
async function purgeLibraries(env, personalCode) {
  var indexKey = await ownerIndexKey(personalCode);
  var indexObject = await env.FAVORITES_BUCKET.get(indexKey);
  if (!indexObject) return;
  var data = await indexObject.json();
  var codes = (data && Array.isArray(data.codes))
    ? data.codes.filter(function (c) { return typeof c === 'string'; })
    : [];
  for (var i = 0; i < codes.length; i++) {
    var object = await env.FAVORITES_BUCKET.get('library/' + codes[i] + '.json');
    // 원본이 이미 없으면(이전 시도가 R2만 지우고 실패) 소유를 증명할 수 없지만,
    // 이 계정의 소유 색인에 있던 코드의 남은 색인·숨김 행은 지워도 안전하다
    if (!object) {
      await deleteLibraryRecord(env, codes[i]);
      continue;
    }
    var record = await object.json();
    // 색인은 조회 편의용이라 남의 코드가 섞일 수 있다 — 소유 증명이 맞을 때만 지운다
    if (record && record.ownerHash && record.ownerHash === await ownerHashFor(personalCode, codes[i])) {
      await deleteLibraryRecord(env, codes[i]);
    }
  }
  await env.FAVORITES_BUCKET.delete(indexKey);
}

// 삭제 표식을 남긴다(이미 있으면 처음 값을 유지). 표식 테이블이 없으면 throw.
async function markDeleted(env, ownerHash, by) {
  await env.TAGS_DB.prepare(
    'INSERT INTO deleted_accounts (owner_hash, deleted_at, deleted_by, pending) VALUES (?, ?, ?, 1) ' +
    'ON CONFLICT(owner_hash) DO NOTHING'
  ).bind(ownerHash, Date.now(), by).run();
}

// 프로필·연결 행·프로필 랭킹 줄을 한 batch 로 지운다. 랭킹 줄은 프로필 ID 에서 만든 게임 해시로 찾는다.
// 마감 뒤 자동 정리(loginCodeSweep.js)도 같은 방식으로 지운다.
export async function deleteProfileRows(env, profileId) {
  var gameHash = await gameHashFor(profileId);
  await env.TAGS_DB.batch([
    env.TAGS_DB.prepare('DELETE FROM profile_links WHERE profile_id = ?').bind(profileId),
    env.TAGS_DB.prepare('DELETE FROM game_scores WHERE player_hash = ?').bind(gameHash),
    env.TAGS_DB.prepare('DELETE FROM profiles WHERE profile_id = ?').bind(profileId)
  ]);
}

// 이 코드에 걸린 아이디 행을 지워 아이디를 풀어 준다. 테이블이 아직 없으면 무시하고, 그 밖의 D1 오류는 throw.
async function deleteLoginId(env, personalCode) {
  try {
    await env.TAGS_DB.prepare('DELETE FROM login_ids WHERE personal_code = ?').bind(personalCode).run();
  } catch (e) {
    if (String(e && e.message || '').indexOf('no such table') === -1) throw e;
  }
}

// by: 'self' | 'admin'. 표식 테이블이 없으면 throw 한다(표식 없이 지우면 되살아날 수 있어 호출자가 503).
export async function purgeByCode(env, personalCode, by) {
  var ownerHash = await profileOwnerHash(personalCode);
  await markDeleted(env, ownerHash, by);

  await purgeLibraries(env, personalCode);

  var profile = await env.TAGS_DB.prepare('SELECT profile_id FROM profiles WHERE owner_hash = ?').bind(ownerHash).first();
  if (profile) await deleteProfileRows(env, profile.profile_id);

  await env.FAVORITES_BUCKET.delete(await userStoreKey(personalCode));
  await deleteLoginId(env, personalCode);
  await env.TAGS_DB.prepare('UPDATE deleted_accounts SET pending = 0 WHERE owner_hash = ?').bind(ownerHash).run();
}

// 관리자가 프로필 한 개로 계정을 지운다. 관리자는 개인 코드를 모르므로 프로필 쪽에서 닿는 것만 지운다:
// 표식(pending=1) → 연결 행 읽기 → 그 프로필의 서재 → 프로필·연결·랭킹 줄.
// 계정 본체와 소유 색인은 코드를 아는 다음 요청(deletedAccountResponse)이 마저 지운다.
// 표식 테이블이 없으면 throw 한다(호출자가 503).
export async function purgeByProfile(env, profileRow) {
  var profileId = profileRow.profile_id;
  // 아이디가 있는 계정은 코드를 알 수 있으므로 끝에서 계정 전체를 마저 지운다.
  var loginRow = null;
  try {
    loginRow = await env.TAGS_DB.prepare('SELECT personal_code FROM login_ids WHERE owner_hash = ?')
      .bind(profileRow.owner_hash).first();
  } catch (e) {}
  await markDeleted(env, profileRow.owner_hash, 'admin');

  var link = null;
  try {
    link = await env.TAGS_DB.prepare('SELECT * FROM profile_links WHERE profile_id = ?').bind(profileId).first();
  } catch (e) {}

  // 서재를 먼저 지우고 프로필 행을 마지막에 지운다 — 서재 삭제가 실패해도 프로필이 남아 관리자가 다시 시도할 수 있다.
  var index = await readLibraryIndex(env);
  // 색인이 없고 만들던 중이면 null — 서재가 없는 것으로 보고 넘어가지 않는다
  if (!index) throw new Error('library index unavailable');
  var libraryCodes = index
    .filter(function (item) { return item.profileId === profileId; })
    .map(function (item) { return item.code; });
  for (var i = 0; i < libraryCodes.length; i++) await deleteLibraryRecord(env, libraryCodes[i]);
  await deleteProfileRows(env, profileId);
  if (loginRow) await purgeByCode(env, loginRow.personal_code, 'admin');
  return { link: link, libraryCodes: libraryCodes };
}
