// 공식 태그 덮어쓰기(adminOfficialTags.js)와 태그 정의(adminTagDefs.js), 공개 투표
// 검증(favoritesShareWorker.js)이 함께 쓰는 태그 도우미.
//
// 공개 파일 R2 tags/official-overrides.json 은 두 D1 소스를 합쳐 굽는다:
//   { v: 2, items: { "novel:123": [...] }, tags: [정의] | null, renames: { 옛: 새 } }
// 어느 쪽이 바뀌든 publishTagFile 로 파일 전체를 다시 만든다. 브라우저
// (src/js/config/cdnConfig.js)는 v1(items 만)도 받는다.

export var TAG_DEFS_KEY = 'tag-definitions';
var TAG_FILE_KEY = 'tags/official-overrides.json';
var MAX_TAG_LENGTH = 20;
// 쉼표는 태그보정.md 의 구분자라 막고, 제어·폭 없는·방향 문자도 막는다.
export var BAD_TAG_RE = /[,\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/;

// 공백 정리(NFC, 앞뒤 공백 제거) 후 1~20자. 규칙에 어긋나면 null.
export function cleanTagName(raw) {
  if (typeof raw !== 'string') return null;
  var tag = raw.normalize('NFC').trim();
  var length = Array.from(tag).length;
  if (length < 1 || length > MAX_TAG_LENGTH || BAD_TAG_RE.test(tag)) return null;
  return tag;
}

// 저장된 태그 정의 문서. 없으면 null, D1 오류는 호출부로 던진다.
export async function readTagDefinitions(env) {
  var row = await env.TAGS_DB.prepare('SELECT doc, version FROM site_documents WHERE key = ?')
    .bind(TAG_DEFS_KEY).first();
  return row ? { doc: JSON.parse(row.doc), version: row.version } : null;
}

// D1 의 덮어쓰기 전체 + 태그 정의로 공개 파일을 다시 만든다. 실패하면 false —
// 다음 변경 때 다시 구워진다.
export async function publishTagFile(env) {
  try {
    var rows = (await env.TAGS_DB.prepare('SELECT item_type, item_id, tags FROM official_tag_overrides').all()).results || [];
    var items = {};
    rows.forEach(function (r) { items[r.item_type + ':' + r.item_id] = JSON.parse(r.tags); });
    var defs = await readTagDefinitions(env);
    var body = {
      v: 2,
      items: items,
      tags: defs ? defs.doc.tags : null,
      renames: (defs && defs.doc.renames) || {}
    };
    await env.FAVORITES_BUCKET.put(TAG_FILE_KEY, JSON.stringify(body), {
      httpMetadata: { contentType: 'application/json' }
    });
    return true;
  } catch (e) {
    return false;
  }
}
