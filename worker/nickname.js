// 닉네임·자기소개 공용 검사. 게임 랭킹(favoritesShareWorker.js)과 유저 프로필
// (profileApi.js, adminProfiles.js)이 같은 정리 규칙과 금지어 목록을 쓴다.

// 관리자가 닉네임을 초기화할 때 붙이는 이름(`유저` + 공개 ID 앞 6자, 겹치면 전체 ID).
// 유저는 이 형식을 직접 고를 수 없어서 초기화한 이름이 남의 닉네임과 겹치지 않는다.
export const RESERVED_NICKNAME_RE = /^유저[A-Za-z0-9_-]{6,12}$/;

// 제어 문자·폭 없는 문자·방향 바꾸는 문자를 지우고 공백을 하나로 줄인다.
// 남은 글자가 1~max 자(코드 포인트)여야 한다.
export function cleanNickname(raw, max) {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  var name = raw.normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  var length = Array.from(name).length;
  return length >= 1 && length <= max ? name : null;
}

// 관리 페이지의 금지어(banned_nicknames, 소문자로 저장)가 texts 중 하나에라도
// 들어 있으면 true. 관리 테이블이 아직 없거나 조회가 실패하면 막지 않는다 —
// 부가 제약이 등록 자체를 막지 않도록.
export async function bannedWordIn(env, texts) {
  try {
    var rows = (await env.TAGS_DB.prepare('SELECT word FROM banned_nicknames').all()).results || [];
    var lowered = texts.map(function (text) { return String(text || '').toLowerCase(); });
    return rows.some(function (r) {
      return lowered.some(function (text) { return text.indexOf(r.word) !== -1; });
    });
  } catch (e) {
    return false;
  }
}
