// 아이디 로그인 공용 상수·형식 검사. 브라우저 UserData 의 같은 값과 맞아야 한다.

// 2026-11-01 00:00 KST. 이 시각 뒤에는 아이디 없는 코드 계정이 정리된다.
export const LOGIN_CODE_DEADLINE = Date.UTC(2026, 9, 31, 15, 0, 0);
export const LOGIN_ID_COOLDOWN_MS = 86400000;

var LOGIN_ID_RE = /^[a-z0-9_]{4,20}$/;

// trim + 소문자로 바꾼 값이 규칙에 맞으면 그 값을, 아니면 null.
export function normalizeLoginId(raw) {
  if (typeof raw !== 'string') return null;
  var id = raw.trim().toLowerCase();
  return LOGIN_ID_RE.test(id) ? id : null;
}
